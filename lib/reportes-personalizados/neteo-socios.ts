// Neteo Particulares (Kawellu: GG y JD). Cada socio carga gastos personales a
// su proyecto del centro "Cuentas Particulares"; mes a mes se compara cuánto
// gastó cada uno y el que gastó menos tiene a favor la diferencia. Puro: recibe
// el resultado del P&L filtrado por cada proyecto (centavos, egresos negativos).
//
// Convención de la planilla que llevaban: neteo = gasto A − gasto B. Positivo
// = A gastó más → netea B (B puede consumir esa diferencia); negativo → netea A.

export type NeteoSocios = {
  gastoA: number[];
  gastoB: number[];
  neteo: number[];
  /** Saldo acumulado al cierre de cada mes, arrastrando el saldo anterior. */
  acumulado: number[];
  saldoAnterior: number;
  total: { gastoA: number; gastoB: number; neteo: number; saldoFinal: number };
};

export function calcularNeteoSocios(resultadoA: number[], resultadoB: number[], saldoAnterior = 0): NeteoSocios {
  // El gasto es lo que el proyecto resta al resultado (si algo le suma, baja el gasto).
  const gastoA = resultadoA.map((v) => (v === 0 ? 0 : -v));
  const gastoB = resultadoB.map((v) => (v === 0 ? 0 : -v));
  const neteo = gastoA.map((a, i) => a - gastoB[i]);
  let corrido = saldoAnterior;
  const acumulado = neteo.map((n) => (corrido += n));
  const suma = (v: number[]) => v.reduce((a, b) => a + b, 0);
  return {
    gastoA,
    gastoB,
    neteo,
    acumulado,
    saldoAnterior,
    total: { gastoA: suma(gastoA), gastoB: suma(gastoB), neteo: suma(neteo), saldoFinal: corrido },
  };
}
