// Control aritmético del recibo (misma filosofía que lib/checks/aritmetica de
// comprobantes): todo en centavos enteros, con tolerancia de $1 porque los
// recibos traen concepto "Redondeo".

export type TotalesRecibo = {
  brutoRemunerativo: number | null;
  noRemunerativo: number | null;
  retenciones: number | null;
  sueldoNeto: number | null;
  contribucionesEmpleador: number | null;
  costoTotalEmpleador: number | null;
};

const TOLERANCIA_CENTAVOS = 100;

const cents = (v: number | null): number | null => (v == null ? null : Math.round(v * 100));

export function verificarAritmeticaRecibo(t: TotalesRecibo): Record<string, string> {
  const revisar: Record<string, string> = {};
  const bruto = cents(t.brutoRemunerativo);
  const noRem = cents(t.noRemunerativo) ?? 0;
  const ret = cents(t.retenciones);
  const neto = cents(t.sueldoNeto);
  const contrib = cents(t.contribucionesEmpleador);
  const costo = cents(t.costoTotalEmpleador);

  if (bruto == null) revisar.brutoRemunerativo = 'No se pudo extraer el bruto remunerativo';
  if (ret == null) revisar.retenciones = 'No se pudieron extraer las retenciones';
  if (neto == null) revisar.sueldoNeto = 'No se pudo extraer el sueldo neto';
  if (contrib == null) revisar.contribucionesEmpleador = 'No se pudieron extraer las contribuciones del empleador';
  if (costo == null) revisar.costoTotalEmpleador = 'No se pudo extraer el costo total empleador';

  if (bruto != null && ret != null && neto != null) {
    const esperado = bruto - ret + noRem;
    if (Math.abs(esperado - neto) > TOLERANCIA_CENTAVOS) {
      revisar.sueldoNeto = `El neto no cierra: bruto − retenciones + no rem = ${(esperado / 100).toFixed(2)}, el recibo dice ${(neto / 100).toFixed(2)}`;
    }
  }
  if (bruto != null && contrib != null && costo != null) {
    const esperado = bruto + noRem + contrib;
    if (Math.abs(esperado - costo) > TOLERANCIA_CENTAVOS) {
      revisar.costoTotalEmpleador = `El costo total no cierra: bruto + no rem + contribuciones = ${(esperado / 100).toFixed(2)}, el recibo dice ${(costo / 100).toFixed(2)}`;
    }
  }
  return revisar;
}

/** Costo total calculado cuando el modelo de recibo no lo imprime. */
export function calcularCostoTotal(t: TotalesRecibo): number | null {
  const bruto = cents(t.brutoRemunerativo);
  const contrib = cents(t.contribucionesEmpleador);
  if (bruto == null || contrib == null) return null;
  return (bruto + (cents(t.noRemunerativo) ?? 0) + contrib) / 100;
}
