// Arithmetic consistency of an extracted voucher:
// neto + iva21 + iva105 + iva27 + percIVA + percIIBB + otros + noGravado == total
// with a tolerance of ±$1 (rounding differences are common on printed vouchers).
// All math is done in integer cents to avoid float drift.

export type ImportesComprobante = {
  netoGravado?: number | null;
  iva21?: number | null;
  iva105?: number | null;
  iva27?: number | null;
  percepcionesIva?: number | null;
  percepcionesIibb?: number | null;
  otrosTributos?: number | null;
  noGravadoExento?: number | null;
  total?: number | null;
};

export const TOLERANCIA_CENTAVOS = 100; // ±$1.00

export function aCentavos(valor: number | null | undefined): number {
  if (valor == null || Number.isNaN(valor)) return 0;
  return Math.round(valor * 100);
}

export function checkAritmetica(importes: ImportesComprobante): {
  ok: boolean;
  sumaComponentes: number; // in pesos
  diferencia: number; // in pesos (suma - total)
} {
  const sumaCentavos =
    aCentavos(importes.netoGravado) +
    aCentavos(importes.iva21) +
    aCentavos(importes.iva105) +
    aCentavos(importes.iva27) +
    aCentavos(importes.percepcionesIva) +
    aCentavos(importes.percepcionesIibb) +
    aCentavos(importes.otrosTributos) +
    aCentavos(importes.noGravadoExento);
  const totalCentavos = aCentavos(importes.total);
  const diff = sumaCentavos - totalCentavos;
  return {
    ok: importes.total != null && Math.abs(diff) <= TOLERANCIA_CENTAVOS,
    sumaComponentes: sumaCentavos / 100,
    diferencia: diff / 100,
  };
}
