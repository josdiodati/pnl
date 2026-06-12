import { describe, it, expect } from 'vitest';
import { validarDistribucion, importesPorLinea, repartirEnPartesIguales } from '@/lib/movimientos/distribucion';
import { signoMovimiento, totalFirmadoCentavos } from '@/lib/movimientos/signo';
import { DomainError } from '@/lib/errors';

describe('distribución porcentual: suma exacta = 100', () => {
  it('acepta una línea al 100%', () => {
    expect(() => validarDistribucion([{ centroCostoId: 'a', porcentaje: 100 }])).not.toThrow();
  });

  it('acepta 60/40 y 60/30/10', () => {
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: 60 },
        { centroCostoId: 'b', porcentaje: 40 },
      ]),
    ).not.toThrow();
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: 60 },
        { centroCostoId: 'b', porcentaje: 30 },
        { centroCostoId: 'c', porcentaje: 10 },
      ]),
    ).not.toThrow();
  });

  it('acepta decimales que cierran (33.3333/33.3333/33.3334)', () => {
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: 33.3333 },
        { centroCostoId: 'b', porcentaje: 33.3333 },
        { centroCostoId: 'c', porcentaje: 33.3334 },
      ]),
    ).not.toThrow();
  });

  it('rechaza sumas distintas de 100', () => {
    expect(() => validarDistribucion([{ centroCostoId: 'a', porcentaje: 99.9999 }])).toThrow(DomainError);
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: 60 },
        { centroCostoId: 'b', porcentaje: 50 },
      ]),
    ).toThrow(DomainError);
  });

  it('rechaza líneas vacías, porcentaje 0, negativo o sin centro de costo', () => {
    expect(() => validarDistribucion([])).toThrow(DomainError);
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: 0 },
        { centroCostoId: 'b', porcentaje: 100 },
      ]),
    ).toThrow(DomainError);
    expect(() =>
      validarDistribucion([
        { centroCostoId: 'a', porcentaje: -10 },
        { centroCostoId: 'b', porcentaje: 110 },
      ]),
    ).toThrow(DomainError);
    expect(() => validarDistribucion([{ centroCostoId: '', porcentaje: 100 }])).toThrow(DomainError);
  });
});

describe('importes por línea: la última absorbe el redondeo', () => {
  it('60/40 de $1210 → $726 + $484', () => {
    const importes = importesPorLinea(121000, [
      { centroCostoId: 'a', porcentaje: 60 },
      { centroCostoId: 'b', porcentaje: 40 },
    ]);
    expect(importes).toEqual([72600, 48400]);
  });

  it('tres tercios de $100 suman exactamente $100', () => {
    const importes = importesPorLinea(10000, [
      { centroCostoId: 'a', porcentaje: 33.3333 },
      { centroCostoId: 'b', porcentaje: 33.3333 },
      { centroCostoId: 'c', porcentaje: 33.3334 },
    ]);
    expect(importes.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(importes).toEqual([3333, 3333, 3334]);
  });

  it('funciona con totales negativos (egresos)', () => {
    const importes = importesPorLinea(-121000, [
      { centroCostoId: 'a', porcentaje: 60 },
      { centroCostoId: 'b', porcentaje: 40 },
    ]);
    expect(importes.reduce((a, b) => a + b, 0)).toBe(-121000);
    expect(importes).toEqual([-72600, -48400]);
  });

  it('repartir en partes iguales siempre suma 100', () => {
    for (const n of [1, 2, 3, 6, 7, 11]) {
      const partes = repartirEnPartesIguales(n);
      expect(partes.reduce((a, b) => a + Math.round(b * 10000), 0)).toBe(1000000);
    }
  });
});

describe('tabla de signos contables (doc 07)', () => {
  it('ingreso suma, egreso resta', () => {
    expect(signoMovimiento('INGRESO', 'FACTURA_A')).toBe(1);
    expect(signoMovimiento('EGRESO', 'FACTURA_A')).toBe(-1);
    expect(signoMovimiento('EGRESO', null)).toBe(-1);
  });

  it('notas de crédito invierten', () => {
    expect(signoMovimiento('EGRESO', 'NOTA_CREDITO_A')).toBe(1); // NC de compra reduce el gasto
    expect(signoMovimiento('INGRESO', 'NOTA_CREDITO_B')).toBe(-1); // NC de venta reduce el ingreso
  });

  it('notas de débito mantienen el signo de la factura', () => {
    expect(signoMovimiento('EGRESO', 'NOTA_DEBITO_A')).toBe(-1);
    expect(signoMovimiento('INGRESO', 'NOTA_DEBITO_B')).toBe(1);
  });

  it('importe negativo en asiento manual invierte naturalmente', () => {
    expect(totalFirmadoCentavos('EGRESO', null, -100)).toBe(10000); // ajuste a favor
    expect(totalFirmadoCentavos('EGRESO', null, 100)).toBe(-10000);
  });
});
