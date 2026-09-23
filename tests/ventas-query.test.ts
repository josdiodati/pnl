import { describe, it, expect } from 'vitest';
import { buildWhereVentas, resumirVentas, netoVentaCentavos, ORIGENES_VENTA, type VentaResumible } from '@/lib/ventas/query';
import { baseImponibleFirmada } from '@/lib/reportes/pnl';

const opts = { esValidador: true, usuarioId: 'u1' };

describe('buildWhereVentas', () => {
  it('siempre restringe a los orígenes de venta', () => {
    expect(buildWhereVentas({}, opts).origen).toEqual({ in: ORIGENES_VENTA });
  });

  it('un cargador sólo ve lo que cargó', () => {
    expect(buildWhereVentas({}, { esValidador: false, usuarioId: 'u9' }).creadoPorId).toBe('u9');
    expect(buildWhereVentas({}, opts).creadoPorId).toBeUndefined();
  });

  it('filtra por estado y cliente', () => {
    const w = buildWhereVentas({ estado: 'ASIGNADO', contraparteId: 'c1' }, opts);
    expect(w.estado).toBe('ASIGNADO');
    expect(w.contraparteId).toBe('c1');
  });

  it('filtra por rango de fechas de devengamiento', () => {
    const w = buildWhereVentas({ desde: '2026-09-01', hasta: '2026-09-30' }, opts);
    expect(w.fechaDevengamiento).toEqual({
      gte: new Date('2026-09-01T00:00:00Z'),
      lte: new Date('2026-09-30T23:59:59Z'),
    });
  });

  it('la búsqueda libre cruza cliente, descripción, número y CUIT (insensible a mayúsculas)', () => {
    const w = buildWhereVentas({ q: '  Acme ' }, opts);
    const contains = { contains: 'Acme', mode: 'insensitive' };
    expect(w.OR).toEqual([
      { descripcion: contains },
      { numero: contains },
      { contraparte: { razonSocial: contains } },
      { contraparte: { cuit: contains } },
    ]);
  });

  it('una búsqueda vacía o de espacios no agrega condición', () => {
    expect(buildWhereVentas({ q: '   ' }, opts).OR).toBeUndefined();
    expect(buildWhereVentas({}, opts).OR).toBeUndefined();
  });
});

const venta = (over: Partial<VentaResumible>): VentaResumible => ({
  estado: 'ASIGNADO',
  total: 1210,
  iva21: 210,
  tipoComprobante: 'FACTURA_A',
  moneda: 'ARS',
  tipoCambio: null,
  ...over,
});

describe('netoVentaCentavos — neto de IVA por línea', () => {
  it('descuenta el IVA discriminado del total', () => {
    expect(netoVentaCentavos(venta({ total: 1210, iva21: 210 }))).toBe(100_000);
    expect(netoVentaCentavos(venta({ total: 1000, iva21: null, iva105: 50, iva27: 30 }))).toBe(92_000);
  });

  it('usa la misma base que el reporte P&L: también descuenta percepciones y otros tributos', () => {
    const v = venta({ total: 1300, iva21: 210, percepcionesIva: 30, percepcionesIibb: 40, otrosTributos: 20 });
    const esperado = baseImponibleFirmada({
      anio: 2026, mes: 9, categoriaId: 'c', tipoCategoria: 'INGRESO', esCostoPersonal: false,
      tipoComprobante: 'FACTURA_A', moneda: 'ARS', tipoCambio: null, total: 1300,
      iva21: 210, iva105: null, iva27: null, percepcionesIva: 30, percepcionesIibb: 40, otrosTributos: 20,
    });
    expect(netoVentaCentavos(v)).toBe(esperado);
    expect(netoVentaCentavos(v)).toBe(100_000);
  });

  it('sin desglose de IVA el neto es el total (no hay nada que descontar)', () => {
    expect(netoVentaCentavos(venta({ total: 500, iva21: null }))).toBe(50_000);
  });

  it('las notas de crédito dan neto negativo', () => {
    expect(netoVentaCentavos(venta({ tipoComprobante: 'NOTA_CREDITO_A' }))).toBe(-100_000);
  });

  it('moneda extranjera convierte con TC; sin TC o sin total es null', () => {
    expect(netoVentaCentavos(venta({ total: 121, iva21: 21, moneda: 'USD', tipoCambio: 1000 }))).toBe(10_000_000);
    expect(netoVentaCentavos(venta({ moneda: 'USD', tipoCambio: null }))).toBeNull();
    expect(netoVentaCentavos(venta({ total: null }))).toBeNull();
  });
});

describe('resumirVentas — total de lo filtrado, neto de IVA', () => {
  it('el número principal es el neto; el total con IVA queda como referencia', () => {
    const r = resumirVentas([
      venta({ estado: 'ASIGNADO', total: 1210, iva21: 210 }),
      venta({ estado: 'PENDIENTE_VALIDACION', total: 605, iva21: 105 }),
      venta({ estado: 'VALIDADO', total: 100, iva21: null }),
    ]);
    expect(r.netoCentavos).toBe(160_000);
    expect(r.totalCentavos).toBe(191_500);
    expect(r.cantidad).toBe(3);
  });

  it('las notas de crédito restan, sin necesidad de categoría', () => {
    const r = resumirVentas([
      venta({ total: 1210, iva21: 210 }),
      venta({ total: 363, iva21: 63, tipoComprobante: 'NOTA_CREDITO_A' }),
    ]);
    expect(r.netoCentavos).toBe(70_000);
    expect(r.totalCentavos).toBe(84_700);
  });

  it('las anuladas no suman pero sí se cuentan como listadas', () => {
    const r = resumirVentas([venta({}), venta({ total: 999, estado: 'ANULADO' })]);
    expect(r.netoCentavos).toBe(100_000);
    expect(r.cantidad).toBe(2);
  });

  it('desglosa el neto ya asignado (lo único que impacta el resultado)', () => {
    const r = resumirVentas([
      venta({ estado: 'ASIGNADO', total: 1210, iva21: 210 }),
      venta({ estado: 'VALIDADO', total: 605, iva21: 105 }),
    ]);
    expect(r.asignadoCentavos).toBe(100_000);
    expect(r.asignadas).toBe(1);
  });

  it('moneda extranjera se convierte con el tipo de cambio; sin TC queda fuera y se avisa', () => {
    const r = resumirVentas([
      venta({ total: 12.1, iva21: 2.1, moneda: 'USD', tipoCambio: 1000 }),
      venta({ total: 10, iva21: null, moneda: 'USD', tipoCambio: null }),
    ]);
    expect(r.netoCentavos).toBe(1_000_000);
    expect(r.totalCentavos).toBe(1_210_000);
    expect(r.sinTipoCambio).toBe(1);
  });

  it('ignora ventas sin total', () => {
    const r = resumirVentas([venta({ total: null })]);
    expect(r.netoCentavos).toBe(0);
    expect(r.cantidad).toBe(1);
  });
});
