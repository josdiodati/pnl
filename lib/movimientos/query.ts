import type { Prisma } from '@prisma/client';
import { signoMovimiento } from './signo';
import { importesPorLinea } from './distribucion';

// Shared filter/summary logic for the Movimientos table and its CSV export.

export type FiltrosMovimientos = {
  desde?: string;
  hasta?: string;
  categoriaId?: string;
  centroCostoId?: string;
  clienteProyectoId?: string;
  contraparteId?: string;
  origen?: string;
  estado?: string;
  canal?: string;
};

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
  if (f.estado) where.estado = f.estado as never;
  if (f.canal) where.canalIngreso = f.canal;
  if (f.centroCostoId || f.clienteProyectoId) {
    where.lineas = {
      some: {
        ...(f.centroCostoId ? { centroCostoId: f.centroCostoId } : {}),
        ...(f.clienteProyectoId ? { clienteProyectoId: f.clienteProyectoId } : {}),
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
  lineas: { centroCostoId: string; clienteProyectoId: string | null; porcentaje: unknown }[];
};

/** Signed total in cents; null when not computable (no category/total yet). */
export function totalFirmadoDe(mov: MovimientoConRelaciones): number | null {
  if (mov.total == null || !mov.categoria) return null;
  return signoMovimiento(mov.categoria.tipo, mov.tipoComprobante) * Math.round(Number(mov.total) * 100);
}

export type ResumenMovimientos = {
  ingresos: number; // cents, only VALIDADO
  egresos: number;
  resultado: number;
  porCentroCosto: Map<string, number>;
  porClienteProyecto: Map<string, number>;
};

/**
 * Mini-summary over VALIDADO movements of the selection: income / expenses /
 * result plus the breakdown by cost center and client/project, distributing
 * each movement's signed total across its percentage lines (cent-exact).
 */
export function resumirMovimientos(movs: MovimientoConRelaciones[]): ResumenMovimientos {
  let ingresos = 0;
  let egresos = 0;
  const porCentroCosto = new Map<string, number>();
  const porClienteProyecto = new Map<string, number>();

  for (const mov of movs) {
    if (mov.estado !== 'VALIDADO') continue;
    const firmado = totalFirmadoDe(mov);
    if (firmado == null) continue;
    if (firmado >= 0) ingresos += firmado;
    else egresos += firmado;

    if (mov.lineas.length) {
      const lineas = mov.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteProyectoId: l.clienteProyectoId,
        porcentaje: Number(l.porcentaje),
      }));
      try {
        const importes = importesPorLinea(firmado, lineas);
        lineas.forEach((l, i) => {
          porCentroCosto.set(l.centroCostoId, (porCentroCosto.get(l.centroCostoId) ?? 0) + importes[i]);
          if (l.clienteProyectoId) {
            porClienteProyecto.set(l.clienteProyectoId, (porClienteProyecto.get(l.clienteProyectoId) ?? 0) + importes[i]);
          }
        });
      } catch {
        // legacy/inconsistent lines: skip breakdown but keep totals
      }
    }
  }
  return { ingresos, egresos, resultado: ingresos + egresos, porCentroCosto, porClienteProyecto };
}
