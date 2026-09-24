import { describe, it, expect } from 'vitest';
import { calcularReparto, sugerenciaRetencion, UMBRAL_RETENCION, type FacturaReparto, type InstrumentoReparto } from '@/lib/cobranzas/reparto';
import { DomainError } from '@/lib/errors';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const fac = (id: string, saldo: number, fecha = '2026-07-31', over: Partial<FacturaReparto> = {}): FacturaReparto => ({
  id, saldo, fecha: d(fecha), moneda: 'ARS', tcFactura: 1, ...over,
});
const ins = (monto: number, over: Partial<InstrumentoReparto> = {}): InstrumentoReparto => ({
  instrumento: 'TRANSFERENCIA', monto, moneda: 'ARS', fecha: d('2026-08-05'), fechaAcreditacion: d('2026-08-05'), ...over,
});

describe('calcularReparto: FIFO', () => {
  it('un pago cancela varias facturas empezando por la más vieja', () => {
    const r = calcularReparto({ facturas: [fac('b', 500, '2026-08-01'), fac('a', 300, '2026-07-01')], instrumentos: [ins(700)] });
    expect(r.instrumentos[0].aplicaciones).toEqual([
      { movimientoId: 'a', importe: 300, importeArs: 300, diferenciaCambioArs: 0 },
      { movimientoId: 'b', importe: 400, importeArs: 400, diferenciaCambioArs: 0 },
    ]);
    expect(r.faltante).toBe(100);
  });

  it('varios cheques para una factura', () => {
    const r = calcularReparto({
      facturas: [fac('a', 1000)],
      instrumentos: [ins(400, { instrumento: 'CHEQUE', fechaAcreditacion: d('2026-09-01') }), ins(600, { instrumento: 'CHEQUE', fechaAcreditacion: d('2026-10-01') })],
    });
    expect(r.instrumentos.map((i) => i.aplicaciones)).toEqual([
      [{ movimientoId: 'a', importe: 400, importeArs: 400, diferenciaCambioArs: 0 }],
      [{ movimientoId: 'a', importe: 600, importeArs: 600, diferenciaCambioArs: 0 }],
    ]);
    expect(r.faltante).toBe(0);
  });

  it('las retenciones y NC se aplican al final, después de los instrumentos bancarios', () => {
    const r = calcularReparto({ facturas: [fac('a', 100, '2026-07-01'), fac('b', 100, '2026-07-02')], instrumentos: [ins(20, { instrumento: 'RETENCION' }), ins(180)] });
    expect(r.instrumentos.map((i) => i.instrumento)).toEqual(['TRANSFERENCIA', 'RETENCION']);
    expect(r.instrumentos[1].aplicaciones).toEqual([{ movimientoId: 'b', importe: 20, importeArs: 20, diferenciaCambioArs: 0 }]);
  });

  it('no puede superar el saldo', () => {
    expect(() => calcularReparto({ facturas: [fac('a', 100)], instrumentos: [ins(100.5)] })).toThrow(DomainError);
  });

  it('exige facturas de una misma moneda y al menos un instrumento con monto', () => {
    expect(() => calcularReparto({ facturas: [fac('a', 1), fac('b', 1, '2026-07-31', { moneda: 'USD', tcFactura: 1500 })], instrumentos: [ins(1)] })).toThrow(/misma moneda/);
    expect(() => calcularReparto({ facturas: [fac('a', 1)], instrumentos: [] })).toThrow(DomainError);
    expect(() => calcularReparto({ facturas: [fac('a', 1)], instrumentos: [ins(0)] })).toThrow(DomainError);
  });

  it('facturas en pesos se cobran en pesos', () => {
    expect(() => calcularReparto({ facturas: [fac('a', 100)], instrumentos: [ins(1, { moneda: 'USD' })] })).toThrow(/pesos/);
  });
});

describe('calcularReparto: retención de la diferencia', () => {
  it('cierra la diferencia como retención si se pide y está dentro del umbral', () => {
    // Caso real Comnet: factura 15.136.816,51, acreditado 14.886.621,17.
    const r = calcularReparto({ facturas: [fac('a', 15136816.51)], instrumentos: [ins(14886621.17)], cerrarDiferenciaComoRetencion: true });
    expect(r.faltante).toBe(0);
    expect(r.instrumentos.map((i) => [i.instrumento, i.monto])).toEqual([['TRANSFERENCIA', 14886621.17], ['RETENCION', 250195.34]]);
  });
  it('rechaza cerrar como retención una diferencia mayor al umbral', () => {
    expect(UMBRAL_RETENCION).toBe(0.05);
    expect(() => calcularReparto({ facturas: [fac('a', 1000)], instrumentos: [ins(900)], cerrarDiferenciaComoRetencion: true })).toThrow(/5%/);
  });
  it('sugerenciaRetencion', () => {
    expect(sugerenciaRetencion(1000, 960, 'ARS')).toEqual({ sugerir: true, monto: 40 });
    expect(sugerenciaRetencion(1000, 900, 'ARS')).toEqual({ sugerir: false, monto: 100 });
    expect(sugerenciaRetencion(1000, 1000, 'ARS')).toEqual({ sugerir: false, monto: 0 });
    expect(sugerenciaRetencion(1000, 990, 'USD')).toEqual({ sugerir: false, monto: 10 });
  });
});

describe('calcularReparto: moneda extranjera', () => {
  const usd = (id: string, saldo: number, tc: number, fecha = '2026-08-19') => fac(id, saldo, fecha, { moneda: 'USD', tcFactura: tc });

  it('cobro en pesos de una factura USD: cotización implícita y diferencia de cambio', () => {
    // Caso real Cubecorp: USD 24.775,17 a TC 1495; entraron $36.505.077,66.
    const r = calcularReparto({ facturas: [usd('e', 24775.17, 1495)], instrumentos: [ins(36505077.66)] });
    expect(r.cotizacion).toBeCloseTo(1473.4545, 3);
    const [a] = r.instrumentos[0].aplicaciones;
    expect(a.importe).toBe(24775.17);
    expect(a.importeArs).toBe(36505077.66);
    expect(a.diferenciaCambioArs).toBe(Math.round((36505077.66 - 24775.17 * 1495) * 100) / 100);
    expect(r.faltante).toBe(0);
  });

  it('con cotización informada cancela sólo lo que alcanza', () => {
    const r = calcularReparto({ facturas: [usd('e', 100, 1500)], instrumentos: [ins(75000)], cotizacion: 1500 });
    expect(r.instrumentos[0].aplicaciones).toEqual([{ movimientoId: 'e', importe: 50, importeArs: 75000, diferenciaCambioArs: 0 }]);
    expect(r.faltante).toBe(50);
  });

  it('cobro en la misma moneda extranjera: pesos al TC de la factura salvo cotización', () => {
    const r = calcularReparto({ facturas: [usd('e', 100, 1500)], instrumentos: [ins(100, { moneda: 'USD' })] });
    expect(r.instrumentos[0].aplicaciones[0]).toEqual({ movimientoId: 'e', importe: 100, importeArs: 150000, diferenciaCambioArs: 0 });
    const r2 = calcularReparto({ facturas: [usd('e', 100, 1500)], instrumentos: [ins(100, { moneda: 'USD' })], cotizacion: 1520 });
    expect(r2.instrumentos[0].aplicaciones[0]).toEqual({ movimientoId: 'e', importe: 100, importeArs: 152000, diferenciaCambioArs: 2000 });
  });

  it('varias facturas USD con un cobro en pesos reparte los pesos exactos', () => {
    const r = calcularReparto({ facturas: [usd('a', 100, 1400, '2026-07-01'), usd('b', 200, 1500, '2026-08-01')], instrumentos: [ins(450000.01)] });
    const aps = r.instrumentos[0].aplicaciones;
    expect(aps.map((a) => a.importe)).toEqual([100, 200]);
    expect(aps.reduce((s, a) => s + a.importeArs, 0)).toBeCloseTo(450000.01, 2);
    expect(aps[0].diferenciaCambioArs).toBeCloseTo(aps[0].importeArs - 140000, 2);
  });

  it('factura USD sin TC: no hay diferencia calculable', () => {
    const r = calcularReparto({ facturas: [fac('e', 10, '2026-08-01', { moneda: 'USD', tcFactura: null })], instrumentos: [ins(15000)] });
    expect(r.instrumentos[0].aplicaciones[0].diferenciaCambioArs).toBe(0);
  });
});
