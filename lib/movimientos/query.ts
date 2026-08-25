import type { Prisma } from '@prisma/client';
import { signoMovimiento } from './signo';
import { importesPorLinea } from './distribucion';

// Shared filter/summary logic for the Movimientos table and its CSV export.

export type FiltrosMovimientos = {
  desde?: string;
  hasta?: string;
  categoriaId?: string;
  centroCostoId?: string;
  clienteId?: string;
  contraparteId?: string;
  origen?: string;
  estado?: string;
  canal?: string;
};

// Movimientos es el libro: muestra SÓLO los movimientos asignados, que son
// exactamente los que impactan el resultado (impactaResultado) y los únicos que
// suman sus propios totales — resumirMovimientos ya contaba sólo asignados, así
// que incluir validados-sin-imputar hacía que la tabla mostrara filas que su
// propio pie no sumaba.
//
// Todo lo demás vive en su cola: un validado sin imputar está en Asignación, lo
// pendiente/observado/retenido en Validación, y la vista de "todo" es Comprobantes.
export const ESTADOS_LIBRO = ['ASIGNADO'] as const;

export function buildWhereMovimientos(
  f: FiltrosMovimientos,
  opts: { esValidador: boolean; usuarioId: string },
): Prisma.MovimientoWhereInput {
  const where: Prisma.MovimientoWhereInput = {};
  // Loaders only ever see their own uploads (doc 08 permission table)
  if (!opts.esValidador) where.creadoPorId = opts.usuarioId;
  if (f.desde || f.hasta) {
    where.fechaDevengamiento = {
      ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00Z`) } : {}),
      ...(f.hasta ? { lte: new Date(`${f.hasta}T23:59:59Z`) } : {}),
    };
  }
  if (f.categoriaId) where.categoriaId = f.categoriaId;
  if (f.contraparteId) where.contraparteId = f.contraparteId;
  if (f.origen) where.origen = f.origen as never;
  // El estado no es filtrable: el libro ES los asignados. Un `estado` que llegue
  // por querystring se ignora, nunca puede ampliar el rango.
  where.estado = { in: ESTADOS_LIBRO } as never;
  if (f.canal) where.canalIngreso = f.canal;
  if (f.centroCostoId || f.clienteId) {
    where.lineas = {
      some: {
        ...(f.centroCostoId ? { centroCostoId: f.centroCostoId } : {}),
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
      },
    };
  }
  return where;
}

export type MovimientoConRelaciones = {
  id: string;
  estado: string;
  total: unknown;
  tipoComprobante: string | null;
  categoria: { tipo: 'INGRESO' | 'EGRESO'; nombre: string } | null;
  lineas: { centroCostoId: string; clienteId: string | null; porcentaje: unknown }[];
  /** Vínculos comprobante→empleado: su monto se descuenta del libro y computa en Costos de personal. */
  vinculosEmpleados?: { monto: unknown }[];
};

/** Signed total in cents; null when not computable (no category/total yet). */
export function totalFirmadoDe(mov: MovimientoConRelaciones): number | null {
  if (mov.total == null || !mov.categoria) return null;
  return signoMovimiento(mov.categoria.tipo, mov.tipoComprobante) * Math.round(Number(mov.total) * 100);
}

/** Suma en centavos de lo vinculado a empleados (0 si no hay vínculos). */
export function montoVinculadoCentavos(mov: MovimientoConRelaciones): number {
  return (mov.vinculosEmpleados ?? []).reduce((acc, v) => acc + Math.round(Number(v.monto) * 100), 0);
}

/** Cómo se lee un importe en el libro. Un movimiento sin categoría NO tiene
 *  signo — el signo lo define la categoría — así que no puede mostrarse como
 *  ingreso: en un libro de facturas de proveedores eso invierte el sentido. */
export function tonoImporte(firmado: number | null): 'sin-signo' | 'egreso' | 'ingreso' {
  if (firmado == null) return 'sin-signo';
  return firmado < 0 ? 'egreso' : 'ingreso';
}

export type ResumenMovimientos = {
  ingresos: number; // cents, only ASIGNADO
  egresos: number;
  resultado: number;
  porCentroCosto: Map<string, number>;
  porCliente: Map<string, number>;
};

/**
 * Mini-summary over ASIGNADO movements of the selection: income / expenses /
 * result plus the breakdown by cost center and client/project, distributing
 * each movement's signed total across its percentage lines (cent-exact).
 */
export function resumirMovimientos(movs: MovimientoConRelaciones[]): ResumenMovimientos {
  let ingresos = 0;
  let egresos = 0;
  const porCentroCosto = new Map<string, number>();
  const porCliente = new Map<string, number>();

  for (const mov of movs) {
    if (mov.estado !== 'ASIGNADO') continue;
    const firmadoBruto = totalFirmadoDe(mov);
    if (firmadoBruto == null) continue;
    // Sin doble conteo: la porción vinculada a empleados sale del libro general
    // y entra por resumirCostosPersonal según la distribución del empleado.
    const vinculado = montoVinculadoCentavos(mov);
    const firmado = firmadoBruto < 0
      ? Math.min(firmadoBruto + vinculado, 0)
      : Math.max(firmadoBruto - vinculado, 0);
    if (firmado >= 0) ingresos += firmado;
    else egresos += firmado;

    if (mov.lineas.length) {
      const lineas = mov.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId,
        porcentaje: Number(l.porcentaje),
      }));
      try {
        const importes = importesPorLinea(firmado, lineas);
        lineas.forEach((l, i) => {
          porCentroCosto.set(l.centroCostoId, (porCentroCosto.get(l.centroCostoId) ?? 0) + importes[i]);
          if (l.clienteId) {
            porCliente.set(l.clienteId, (porCliente.get(l.clienteId) ?? 0) + importes[i]);
          }
        });
      } catch {
        // legacy/inconsistent lines: skip breakdown but keep totals
      }
    }
  }
  return { ingresos, egresos, resultado: ingresos + egresos, porCentroCosto, porCliente };
}
