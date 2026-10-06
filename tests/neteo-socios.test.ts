import { describe, it, expect } from 'vitest';
import { calcularNeteoSocios } from '@/lib/reportes-personalizados/neteo-socios';

// Números de la planilla que llevaban GG y JD (oct–dic), en centavos.
describe('calcularNeteoSocios', () => {
  const gg = [-177926979, -543654776, -289755753];
  const jd = [-83898650, -220299822, -443883283];

  it('neteo = gasto GG − gasto JD, como la planilla (positivo netea JD)', () => {
    const r = calcularNeteoSocios(gg, jd);
    expect(r.gastoA).toEqual([177926979, 543654776, 289755753]);
    expect(r.neteo).toEqual([94028329, 323354954, -154127530]);
  });

  it('acumula el saldo arrastrando el saldo anterior', () => {
    const r = calcularNeteoSocios(gg, jd, -10000);
    expect(r.acumulado).toEqual([94018329, 417373283, 263245753]);
    expect(r.total.saldoFinal).toBe(263245753);
    expect(r.total.neteo).toBe(263255753);
    expect(r.total.gastoB).toBe(748081755);
  });

  it('un ingreso asignado al proyecto baja el gasto; meses sin datos quedan en 0', () => {
    const r = calcularNeteoSocios([5000, 0], [0, 0]);
    expect(r.gastoA).toEqual([-5000, 0]);
    expect(r.neteo).toEqual([-5000, 0]);
  });
});
