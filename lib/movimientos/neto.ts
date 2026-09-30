// Neto de un comprobante: total menos IVA (21 / 10,5 / 27), percepciones (IVA
// e IIBB) y otros tributos — la base imponible que usa el reporte P&L. Es EL
// "Neto" de todas las vistas (columna Neto junto a Total), para que un número
// neto signifique lo mismo en todos lados. Sin desglose, neto = total.
// En la moneda del comprobante: pesificar/firmar es del que llama.

import { formatMoney } from '@/lib/format';

type ImportesComprobante = {
  total?: unknown;
  iva21?: unknown;
  iva105?: unknown;
  iva27?: unknown;
  percepcionesIva?: unknown;
  percepcionesIibb?: unknown;
  otrosTributos?: unknown;
};

const n = (v: unknown) => (v == null ? 0 : Number(v));

export function netoDe(mov: ImportesComprobante): number | null {
  if (mov.total == null) return null;
  // Sin redondear: los que pesifican (× TC) redondean al final, como antes.
  return n(mov.total) - n(mov.iva21) - n(mov.iva105) - n(mov.iva27) - n(mov.percepcionesIva) - n(mov.percepcionesIibb) - n(mov.otrosTributos);
}

/** Campos que hay que traer (select de Prisma) para calcular el neto. */
export const SELECT_NETO = {
  total: true,
  iva21: true,
  iva105: true,
  iva27: true,
  percepcionesIva: true,
  percepcionesIibb: true,
  otrosTributos: true,
} as const;

/** Neto con el mismo signo y pesificación que un total ya firmado (centavos):
 *  total firmado × neto / total. Null si no hay total firmado. */
export function netoFirmadoDe(totalFirmadoCentavos: number | null, mov: ImportesComprobante): number | null {
  if (totalFirmadoCentavos == null) return null;
  const total = n(mov.total);
  if (!total) return totalFirmadoCentavos;
  return Math.round((totalFirmadoCentavos * netoDe(mov)!) / total);
}

/** "neto $ X · total $ Y" (+ moneda si no es ARS): para filas y tarjetas que
 *  no son tablas y muestran un comprobante en una sola línea. */
export function textoNetoTotal(mov: ImportesComprobante & { moneda?: string | null }): string {
  if (mov.total == null) return 'sin total';
  const ext = mov.moneda && mov.moneda !== 'ARS' ? ` ${mov.moneda}` : '';
  return `neto ${formatMoney(netoDe(mov))}${ext} · total ${formatMoney(Number(mov.total))}${ext}`;
}
