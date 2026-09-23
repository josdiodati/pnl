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
  iva21?: unknown;
  iva105?: unknown;
  iva27?: unknown;
  percepcionesIva?: unknown;
  percepcionesIibb?: unknown;
  otrosTributos?: unknown;
};

export type ResumenVentas = {
  /** Neto de IVA firmado en centavos de lo listado (sin anuladas), unificado en ARS. */
  netoCentavos: number;
  /** Total con IVA firmado en centavos, como referencia. */
  totalCentavos: number;
  /** Cantidad de comprobantes listados, anuladas incluidas. */
  cantidad: number;
  /** Neto ya asignado: lo único que impacta el resultado. */
  asignadoCentavos: number;
  asignadas: number;
  /** Ventas en moneda extranjera sin tipo de cambio: no se pudieron sumar. */
  sinTipoCambio: number;
};

const n = (v: unknown) => (v == null ? 0 : Number(v));

/** Pesos por unidad de la moneda del comprobante; null si no es computable. */
function tipoCambioDe(v: VentaResumible): number | null {
  if (!v.moneda || v.moneda === 'ARS') return 1;
  const tc = v.tipoCambio == null ? null : Number(v.tipoCambio);
  return tc && tc > 0 ? tc : null;
}

/** Una venta siempre es ingreso: el signo sale sólo del tipo de comprobante
 *  (nota de crédito resta), sin necesidad de categoría. */
function firmar(v: VentaResumible, pesos: number): number {
  return signoMovimiento('INGRESO', v.tipoComprobante) * Math.round(pesos * 100);
}

/** Total con IVA firmado en centavos ARS; null si no es computable. */
export function totalVentaCentavos(v: VentaResumible): number | null {
  const tc = tipoCambioDe(v);
  if (v.total == null || tc == null) return null;
  return firmar(v, Number(v.total) * tc);
}

/** Neto de IVA firmado en centavos ARS: la misma base imponible que usa el
 *  reporte P&L (total menos IVA, percepciones y otros tributos), así la vista
 *  de Ventas y el reporte cuentan lo mismo. Sin desglose, neto = total. */
export function netoVentaCentavos(v: VentaResumible): number | null {
  const tc = tipoCambioDe(v);
  if (v.total == null || tc == null) return null;
  const neto =
    Number(v.total) - n(v.iva21) - n(v.iva105) - n(v.iva27) - n(v.percepcionesIva) - n(v.percepcionesIibb) - n(v.otrosTributos);
  return firmar(v, neto * tc);
}

/** Total de lo filtrado: las pendientes también cuentan; las anuladas no. */
export function resumirVentas(ventas: VentaResumible[]): ResumenVentas {
  const r: ResumenVentas = { netoCentavos: 0, totalCentavos: 0, cantidad: ventas.length, asignadoCentavos: 0, asignadas: 0, sinTipoCambio: 0 };
  for (const v of ventas) {
    if (v.estado === 'ANULADO' || v.total == null) continue;
    const neto = netoVentaCentavos(v);
    const total = totalVentaCentavos(v);
    if (neto == null || total == null) {
      r.sinTipoCambio += 1;
      continue;
    }
    r.netoCentavos += neto;
    r.totalCentavos += total;
    if (v.estado === 'ASIGNADO') {
      r.asignadoCentavos += neto;
      r.asignadas += 1;
    }
  }
  return r;
}
