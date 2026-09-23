import type { EstadoMovimiento, Prisma } from '@prisma/client';
import { signoMovimiento } from '@/lib/movimientos/signo';

// Filtro y resumen compartidos por la vista de Ventas. El resumen es SIEMPRE
// sobre lo que la tabla muestra: si el usuario filtra, la tarjeta filtra.

export const ORIGENES_VENTA = ['VENTA_MANUAL', 'VENTA_COMPROBANTE'] as const;

export type FiltrosVentas = {
  estado?: string;
  contraparteId?: string;
  desde?: string;
  hasta?: string;
  q?: string; // búsqueda libre: cliente, descripción, número, CUIT
};

export function buildWhereVentas(
  f: FiltrosVentas,
  opts: { esValidador: boolean; usuarioId: string },
): Prisma.MovimientoWhereInput {
  const where: Prisma.MovimientoWhereInput = { origen: { in: [...ORIGENES_VENTA] } };
  if (!opts.esValidador) where.creadoPorId = opts.usuarioId;
  if (f.estado) where.estado = f.estado as EstadoMovimiento;
  if (f.contraparteId) where.contraparteId = f.contraparteId;
  if (f.desde || f.hasta) {
    where.fechaDevengamiento = {
      ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00Z`) } : {}),
      ...(f.hasta ? { lte: new Date(`${f.hasta}T23:59:59Z`) } : {}),
    };
  }
  const q = f.q?.trim();
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    where.OR = [
      { descripcion: contains },
      { numero: contains },
      { contraparte: { razonSocial: contains } },
      { contraparte: { cuit: contains } },
    ];
  }
  return where;
}

export type VentaResumible = {
  estado: string;
  total: unknown;
  tipoComprobante: string | null;
  moneda?: string | null;
  tipoCambio?: unknown;
};

export type ResumenVentas = {
  /** Suma firmada en centavos de lo listado (sin anuladas), unificada en ARS. */
  totalCentavos: number;
  /** Cantidad de comprobantes listados, anuladas incluidas. */
  cantidad: number;
  /** Porción ya asignada: lo único que impacta el resultado. */
  asignadoCentavos: number;
  asignadas: number;
  /** Ventas en moneda extranjera sin tipo de cambio: no se pudieron sumar. */
  sinTipoCambio: number;
};

/** Total de lo filtrado. Una venta siempre es ingreso, así que el signo sale
 *  sólo del tipo de comprobante (nota de crédito resta) y no hace falta que
 *  esté categorizada: las pendientes también cuentan. */
export function resumirVentas(ventas: VentaResumible[]): ResumenVentas {
  const r: ResumenVentas = { totalCentavos: 0, cantidad: ventas.length, asignadoCentavos: 0, asignadas: 0, sinTipoCambio: 0 };
  for (const v of ventas) {
    if (v.estado === 'ANULADO' || v.total == null) continue;
    let totalArs = Number(v.total);
    if (v.moneda && v.moneda !== 'ARS') {
      const tc = v.tipoCambio == null ? null : Number(v.tipoCambio);
      if (!tc || !(tc > 0)) {
        r.sinTipoCambio += 1;
        continue;
      }
      totalArs *= tc;
    }
    const firmado = signoMovimiento('INGRESO', v.tipoComprobante) * Math.round(totalArs * 100);
    r.totalCentavos += firmado;
    if (v.estado === 'ASIGNADO') {
      r.asignadoCentavos += firmado;
      r.asignadas += 1;
    }
  }
  return r;
}
