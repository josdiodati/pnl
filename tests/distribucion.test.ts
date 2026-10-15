import { describe, it, expect } from 'vitest';
import {
  validarDistribucion,
  importesPorLinea,
  repartirEnPartesIguales,
  porcentajesDesdeMontos,
  montosDesdePorcentajes,
  esRepartoPorMonto,
  redondearPorcentajes,
} from '@/lib/movimientos/distribucion';
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

describe('reparto por monto neto (el % se deriva con 10 decimales)', () => {
  // Swiss Medical FC A 01020-01135777: neto 5.505.459,88 = 4.310.901,45 (staff) + 1.194.558,43 (GG).
  const neto = 550545988;
  const montos = [431090145, 119455843];
  const comoLineas = (pcts: number[]) => pcts.map((p, i) => ({ centroCostoId: `c${i}`, porcentaje: p }));

  it('los % derivados suman exactamente 100', () => {
    expect(() => validarDistribucion(comoLineas(porcentajesDesdeMontos(montos, neto)))).not.toThrow();
  });

  it('aplicados al neto devuelven los montos al centavo (con y sin signo)', () => {
    const lineas = comoLineas(porcentajesDesdeMontos(montos, neto));
    expect(importesPorLinea(neto, lineas)).toEqual(montos);
    expect(importesPorLinea(-neto, lineas)).toEqual(montos.map((m) => -m));
  });

  it('tres montos arbitrarios de un neto grande cierran al centavo', () => {
    const ms = [987654321, 1234567, 11111111111];
    const total = ms.reduce((a, b) => a + b, 0);
    expect(importesPorLinea(total, comoLineas(porcentajesDesdeMontos(ms, total)))).toEqual(ms);
  });

  it('si los montos no suman el neto, los % no suman 100 (y la validación lo rechaza)', () => {
    expect(() => validarDistribucion(comoLineas(porcentajesDesdeMontos([100000, 100000], 300000)))).toThrow(DomainError);
  });

  it('montosDesdePorcentajes es la inversa (la última absorbe el redondeo)', () => {
    expect(montosDesdePorcentajes([60, 40], 121000)).toEqual([72600, 48400]);
    expect(montosDesdePorcentajes([33.3333, 33.3333, 33.3334], 10000)).toEqual([3333, 3333, 3334]);
  });

  it('esRepartoPorMonto: más de 4 decimales delata un reparto cargado por monto', () => {
    expect(esRepartoPorMonto([60, 40])).toBe(false);
    expect(esRepartoPorMonto([33.3333, 33.3334, 33.3333])).toBe(false);
    expect(esRepartoPorMonto(porcentajesDesdeMontos(montos, neto))).toBe(true);
  });
});

describe('redondear % para una regla (4 decimales, la última absorbe)', () => {
  it('mantiene la suma en 100 con 4 decimales', () => {
    const r = redondearPorcentajes(porcentajesDesdeMontos([431090145, 119455843], 550545988), 4);
    expect(r).toEqual([78.3023, 21.6977]);
  });

  it('deja intactos los % que ya tienen 4 decimales', () => {
    expect(redondearPorcentajes([33.3333, 33.3333, 33.3334], 4)).toEqual([33.3333, 33.3333, 33.3334]);
  });
});

describe('distribución con cliente y proyecto por línea', () => {
  it('acepta líneas con cliente y proyecto opcionales que suman 100', () => {
    expect(() => validarDistribucion([
      { centroCostoId: 'cc1', clienteId: 'cli1', proyectoId: 'pr1', porcentaje: 60 },
      { centroCostoId: 'cc2', clienteId: null, proyectoId: null, porcentaje: 40 },
    ])).not.toThrow();
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
