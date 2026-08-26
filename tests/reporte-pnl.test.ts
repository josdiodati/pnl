import { describe, it, expect } from 'vitest';
import { baseImponibleFirmada, armarPnl, type MovimientoPnl } from '@/lib/reportes/pnl';

// P&L por categoría × mes. SOLO montos netos computan el resultado
// (total − IVA − percepciones − tributos, × TC si es moneda extranjera);
// los impuestos indirectos van como memo debajo del resultado.

const venta: MovimientoPnl = {
  anio: 2026, mes: 7, categoriaId: 'ventas', tipoCategoria: 'INGRESO', esCostoPersonal: false,
  tipoComprobante: 'FACTURA_A', moneda: 'ARS', tipoCambio: null,
  total: 121, iva21: 21, iva105: null, iva27: null,
  percepcionesIva: null, percepcionesIibb: null, otrosTributos: null,
};

const gasto: MovimientoPnl = {
  ...venta, categoriaId: 'servicios', tipoCategoria: 'EGRESO',
  total: 133.1, iva21: 21, percepcionesIibb: 12.1,
};

describe('baseImponibleFirmada', () => {
  it('ingreso: neto positivo (total − IVA)', () => {
    expect(baseImponibleFirmada(venta)).toBe(10_000);
  });
  it('egreso: neto negativo, descuenta IVA y percepciones', () => {
    expect(baseImponibleFirmada(gasto)).toBe(-10_000);
  });
  it('nota de crédito invierte el signo', () => {
    expect(baseImponibleFirmada({ ...venta, tipoComprobante: 'NOTA_CREDITO_A' })).toBe(-10_000);
  });
  it('sin desglose (asiento manual): usa el total', () => {
    expect(baseImponibleFirmada({ ...venta, iva21: null })).toBe(12_100);
  });
  it('moneda extranjera: convierte con el TC; sin TC no computa', () => {
    expect(baseImponibleFirmada({ ...venta, moneda: 'USD', tipoCambio: 1000 })).toBe(10_000_000);
    expect(baseImponibleFirmada({ ...venta, moneda: 'USD', tipoCambio: null })).toBeNull();
  });
});

describe('armarPnl', () => {
  const meses = [{ anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }];
  const pnl = armarPnl({
    meses,
    movimientos: [venta, gasto, { ...venta, mes: 8, total: 242, iva21: 42 }],
    recibos: [{ anio: 2026, mes: 7, costoTotalEmpleador: 50 }],
  });

  it('agrupa por categoría y mes en centavos netos', () => {
    expect(pnl.ingresos.get('ventas')).toEqual([10_000, 20_000]);
    expect(pnl.egresos.get('servicios')).toEqual([-10_000, 0]);
  });

  it('sueldos entran como costos de personal', () => {
    expect(pnl.sueldos).toEqual([-5_000, 0]);
  });

  it('resultado = ingresos + egresos + personal, con total del ejercicio', () => {
    expect(pnl.resultado).toEqual([10_000 - 10_000 - 5_000, 20_000]);
    expect(pnl.totalEjercicio.resultado).toBe(15_000);
  });

  it('memo de impuestos: IVA débito (ventas), crédito (compras), percepciones', () => {
    expect(pnl.memo.ivaDebito).toEqual([2_100, 4_200]);
    expect(pnl.memo.ivaCredito).toEqual([-2_100, 0]);
    expect(pnl.memo.posicionIva).toEqual([0, 4_200]);
    expect(pnl.memo.percepcionesIibb).toEqual([-1_210, 0]);
  });
});
