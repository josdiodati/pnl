import { describe, it, expect } from 'vitest';
import { gradoConciliacion, type LineaConciliada } from '@/lib/resumenes/conciliacion-comprobante';

const linea = (o: Partial<LineaConciliada> = {}): LineaConciliada => ({
  id: 'l1',
  resumenId: 'r1',
  resumen: 'Visa Galicia · Septiembre 2026',
  fecha: new Date('2026-09-10T00:00:00Z'),
  descriptor: 'PROVEEDOR SA',
  monto: -1000,
  moneda: 'ARS',
  montoOrigen: null,
  cuotas: null,
  ...o,
});

describe('gradoConciliacion', () => {
  it('sin líneas: ninguna', () => {
    expect(gradoConciliacion({ total: 1000, moneda: 'ARS', tipoCambio: null }, []).grado).toBe('NINGUNA');
  });

  it('una línea por el total: completa, sin faltante', () => {
    const g = gradoConciliacion({ total: 1000, moneda: 'ARS', tipoCambio: null }, [linea()]);
    expect(g).toMatchObject({ grado: 'COMPLETA', cubierto: 1000, faltante: 0 });
  });

  it('tolera 1% de diferencia (redondeos, percepciones)', () => {
    expect(gradoConciliacion({ total: 1000, moneda: 'ARS', tipoCambio: null }, [linea({ monto: -991 })]).grado).toBe('COMPLETA');
    expect(gradoConciliacion({ total: 1000, moneda: 'ARS', tipoCambio: null }, [linea({ monto: -980 })]).grado).toBe('PARCIAL');
  });

  it('cuotas: suma las líneas y calcula lo que falta', () => {
    const g = gradoConciliacion({ total: 3000, moneda: 'ARS', tipoCambio: null }, [
      linea({ id: 'a', cuotas: '1/3' }),
      linea({ id: 'b', cuotas: '2/3' }),
    ]);
    expect(g).toMatchObject({ grado: 'PARCIAL', cubierto: 2000, faltante: 1000 });
  });

  it('una línea que paga varios comprobantes los cubre a todos (sobrepago = completa)', () => {
    expect(gradoConciliacion({ total: 400, moneda: 'ARS', tipoCambio: null }, [linea({ monto: -1000 })]).grado).toBe('COMPLETA');
  });

  it('comprobante en USD: usa el importe original de la línea en USD', () => {
    const g = gradoConciliacion({ total: 20, moneda: 'USD', tipoCambio: 1450 }, [linea({ monto: null, moneda: 'USD', montoOrigen: -20 })]);
    expect(g).toMatchObject({ grado: 'COMPLETA', cubierto: 20, moneda: 'USD' });
  });

  it('comprobante en USD pagado en pesos: pesos / TC del comprobante', () => {
    const g = gradoConciliacion({ total: 100, moneda: 'USD', tipoCambio: 1500 }, [linea({ monto: -75000 })]);
    expect(g).toMatchObject({ grado: 'PARCIAL', cubierto: 50, faltante: 50 });
  });

  it('línea sin importe medible (USD sin TC): cuenta como cubierta, no inventa un parcial', () => {
    const g = gradoConciliacion({ total: 100, moneda: 'USD', tipoCambio: null }, [linea({ monto: -75000 })]);
    expect(g.grado).toBe('COMPLETA');
    expect(g.cubierto).toBeNull();
  });

  it('comprobante sin total: con líneas es completa', () => {
    expect(gradoConciliacion({ total: null, moneda: 'ARS', tipoCambio: null }, [linea()]).grado).toBe('COMPLETA');
  });
});
