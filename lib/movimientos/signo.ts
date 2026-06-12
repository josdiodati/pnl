import type { TipoCategoria } from '@prisma/client';

// Accounting sign table (doc 07). The sign is DERIVED when computing, never
// stored, and the user never types signs:
//
// | categoría | tipoComprobante     | signo |
// |-----------|---------------------|-------|
// | INGRESO   | (cualquier factura) |  +    |
// | INGRESO   | NOTA_CREDITO_*      |  -    | (credit note on a sale reduces income)
// | EGRESO    | (cualquier factura) |  -    |
// | EGRESO    | NOTA_CREDITO_*      |  +    | (credit note on a purchase reduces expense)
// | *         | NOTA_DEBITO_*       | same as the matching invoice |
//
// Manual adjustment entries may carry a negative amount, which composes with
// this sign (e.g. an EGRESO with total -100 adds +100 to the result).

export function signoMovimiento(tipoCategoria: TipoCategoria, tipoComprobante?: string | null): 1 | -1 {
  const base: 1 | -1 = tipoCategoria === 'INGRESO' ? 1 : -1;
  if (tipoComprobante && tipoComprobante.startsWith('NOTA_CREDITO')) return (base * -1) as 1 | -1;
  return base;
}

/** Signed total in cents (integer) — the only number that feeds totals. */
export function totalFirmadoCentavos(
  tipoCategoria: TipoCategoria,
  tipoComprobante: string | null | undefined,
  total: number, // in pesos, positive for vouchers, may be negative for adjustments
): number {
  return signoMovimiento(tipoCategoria, tipoComprobante) * Math.round(total * 100);
}
