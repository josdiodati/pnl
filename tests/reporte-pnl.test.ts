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

// Categorías marcadas "es impuesto indirecto" (ej. Sircreb): son impuestos, no
// gasto operativo — no modifican el resultado. Van como filas del memo, por
// categoría, junto al IVA y las percepciones.
describe('armarPnl — categorías de impuesto indirecto (ej. Sircreb)', () => {
  const meses = [{ anio: 2026, mes: 7 }];
  const sircreb: MovimientoPnl = {
    ...gasto, categoriaId: 'sircreb', esImpuestoIndirecto: true,
    total: 100, iva21: null, percepcionesIibb: null,
  };

  it('no computa en egresos ni en el resultado; va al memo por categoría', () => {
    const pnl = armarPnl({ meses, movimientos: [sircreb, venta], recibos: [] });
    expect(pnl.egresos.size).toBe(0);
    expect(pnl.resultado).toEqual([10_000]);
    expect(pnl.memo.porCategoria.get('sircreb')).toEqual([-10_000]);
  });

  it('sus propios campos de impuestos no suman al resto del memo', () => {
    const pnl = armarPnl({ meses, movimientos: [{ ...sircreb, total: 121, iva21: 21 }], recibos: [] });
    expect(pnl.memo.ivaCredito).toEqual([0]);
    expect(pnl.memo.porCategoria.get('sircreb')).toEqual([-10_000]);
  });

  it('en la vista por proyecto se omite por completo', () => {
    const pnl = armarPnl({
      meses,
      movimientos: [{ ...sircreb, lineas: [{ centroCostoId: 'cc1', proyectoId: 'p1', porcentaje: 100 }] }],
      recibos: [],
      proyecto: { proyectoId: 'p1' },
    });
    expect(pnl.resultado).toEqual([0]);
    expect(pnl.memo.porCategoria.size).toBe(0);
  });
});

// Vista por proyecto: la porción de cada movimiento se toma de sus líneas de
// distribución con el reparto al centavo (la última línea absorbe el redondeo),
// sobre la MISMA base neta del P&L general — así la suma de todos los proyectos
// más "sin proyecto" reproduce exactamente el total.
describe('armarPnl por proyecto', () => {
  const meses = [{ anio: 2026, mes: 7 }];
  const linea = (proyectoId: string | null, porcentaje: number) => ({
    centroCostoId: 'cc1', proyectoId, porcentaje,
  });
  const ventaRepartida: MovimientoPnl = {
    ...venta,
    lineas: [linea('p1', 33.33), linea('p2', 33.33), linea(null, 33.34)],
  };

  it('toma la porción del proyecto al centavo', () => {
    const pnl = armarPnl({ meses, movimientos: [ventaRepartida], recibos: [], proyecto: { proyectoId: 'p1' } });
    expect(pnl.ingresos.get('ventas')).toEqual([3_333]);
    expect(pnl.resultado).toEqual([3_333]);
  });

  it('proyectoId null toma las líneas sin proyecto (con el redondeo de la última línea)', () => {
    const pnl = armarPnl({ meses, movimientos: [ventaRepartida], recibos: [], proyecto: { proyectoId: null } });
    expect(pnl.ingresos.get('ventas')).toEqual([3_334]);
  });

  it('la suma de proyectos + sin proyecto reproduce el total sin filtro', () => {
    const armar = (proyecto?: { proyectoId: string | null }) =>
      armarPnl({ meses, movimientos: [ventaRepartida, { ...gasto, lineas: [linea('p1', 100)] }], recibos: [], proyecto });
    const total = armar().resultado[0];
    const porPartes = ['p1', 'p2', null].map((p) => armar({ proyectoId: p }).resultado[0]);
    expect(porPartes.reduce((a, v) => a + v, 0)).toBe(total);
  });

  it('movimiento sin líneas: va a "sin distribución" en la vista sin proyecto y no computa en un proyecto', () => {
    const enProyecto = armarPnl({ meses, movimientos: [venta], recibos: [], proyecto: { proyectoId: 'p1' } });
    expect(enProyecto.resultado).toEqual([0]);
    expect(enProyecto.sinDistribucion).toEqual([0]);

    const sinProyecto = armarPnl({ meses, movimientos: [venta], recibos: [], proyecto: { proyectoId: null } });
    expect(sinProyecto.ingresos.get('ventas')).toBeUndefined();
    expect(sinProyecto.sinDistribucion).toEqual([10_000]);
    expect(sinProyecto.resultado).toEqual([10_000]);
  });

  it('sueldos: la fila toma la porción del proyecto según las líneas del recibo', () => {
    const recibo = { anio: 2026, mes: 7, costoTotalEmpleador: 100, lineas: [linea('p1', 40), linea(null, 60)] };
    expect(armarPnl({ meses, movimientos: [], recibos: [recibo], proyecto: { proyectoId: 'p1' } }).sueldos).toEqual([-4_000]);
    expect(armarPnl({ meses, movimientos: [], recibos: [recibo], proyecto: { proyectoId: null } }).sueldos).toEqual([-6_000]);
  });

  it('recibo sin líneas: entero a la vista sin proyecto, nada a un proyecto', () => {
    const recibo = { anio: 2026, mes: 7, costoTotalEmpleador: 100 };
    expect(armarPnl({ meses, movimientos: [], recibos: [recibo], proyecto: { proyectoId: 'p1' } }).sueldos).toEqual([0]);
    expect(armarPnl({ meses, movimientos: [], recibos: [recibo], proyecto: { proyectoId: null } }).sueldos).toEqual([-10_000]);
  });

  it('el memo de impuestos queda en cero con filtro (el IVA es del comprobante, no de la línea)', () => {
    const pnl = armarPnl({ meses, movimientos: [ventaRepartida], recibos: [], proyecto: { proyectoId: 'p1' } });
    expect(pnl.memo.ivaDebito).toEqual([0]);
  });

  it('sin filtro nada cambia: sinDistribucion queda en cero aunque falten líneas', () => {
    const pnl = armarPnl({ meses, movimientos: [venta], recibos: [] });
    expect(pnl.sinDistribucion).toEqual([0]);
    expect(pnl.ingresos.get('ventas')).toEqual([10_000]);
  });
});
