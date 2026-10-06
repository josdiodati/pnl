// Coherencia de un comprobante del libro con su fila de Mis Comprobantes de
// ARCA. El QR lo arma el emisor y puede venir mal (ej. moneda DOL con el
// importe en pesos); ARCA es el registro fiscal, así que manda: si moneda,
// tipo de cambio o importe no coinciden, el comprobante no se autovalida y la
// diferencia queda a la vista. Puro.

const MONEDA_ARCA: Record<string, string> = {
  $: 'ARS', PES: 'ARS', ARS: 'ARS',
  USD: 'USD', DOL: 'USD', 'U$S': 'USD',
  EUR: 'EUR', '060': 'EUR',
};

export function normalizarMonedaArca(moneda: string | null | undefined): string | null {
  const m = moneda?.trim().toUpperCase();
  if (!m) return null;
  return MONEDA_ARCA[m] ?? m;
}

const fmt = (v: number) => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function diferenciasConArca(
  mov: { moneda: string | null | undefined; tipoCambio: number | null | undefined; total: number | null | undefined },
  arca: { moneda: string | null | undefined; tipoCambio: number | null | undefined; importeTotal: number | null | undefined },
): string[] {
  const diferencias: string[] = [];
  const monedaArca = normalizarMonedaArca(arca.moneda);
  const monedaMov = mov.moneda ? normalizarMonedaArca(mov.moneda) : null;
  if (monedaArca && monedaMov && monedaArca !== monedaMov) {
    diferencias.push(`moneda: ARCA dice ${monedaArca} y el comprobante ${monedaMov}`);
  } else if (monedaArca && monedaArca !== 'ARS' && arca.tipoCambio && mov.tipoCambio) {
    // Tolerancia 0,5 %: redondeos de la cotización, no otra fecha de TC.
    if (Math.abs(mov.tipoCambio - arca.tipoCambio) / arca.tipoCambio > 0.005) {
      diferencias.push(`tipo de cambio: ARCA ${fmt(arca.tipoCambio)} y el comprobante ${fmt(mov.tipoCambio)}`);
    }
  }
  if (arca.importeTotal != null && mov.total != null) {
    const tolerancia = Math.max(1, Math.abs(arca.importeTotal) * 0.001);
    if (Math.abs(mov.total - arca.importeTotal) > tolerancia) {
      diferencias.push(`importe total: ARCA ${fmt(arca.importeTotal)} y el comprobante ${fmt(mov.total)}`);
    }
  }
  return diferencias;
}
