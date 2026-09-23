import { describe, it, expect } from 'vitest';
import { buildWhereVentas, resumirVentas, ORIGENES_VENTA, type VentaResumible } from '@/lib/ventas/query';

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

describe('resumirVentas — total de lo filtrado', () => {
  const venta = (over: Partial<VentaResumible>): VentaResumible => ({
    estado: 'ASIGNADO',
    total: 1000,
    tipoComprobante: 'FACTURA_A',
    moneda: 'ARS',
    tipoCambio: null,
    ...over,
  });

  it('suma en centavos todas las ventas listadas, no sólo las asignadas', () => {
    const r = resumirVentas([
      venta({ estado: 'ASIGNADO', total: 1000 }),
      venta({ estado: 'PENDIENTE_VALIDACION', total: 250.5 }),
      venta({ estado: 'VALIDADO', total: 100 }),
    ]);
    expect(r.totalCentavos).toBe(135_050);
    expect(r.cantidad).toBe(3);
  });

  it('las notas de crédito restan, sin necesidad de categoría', () => {
    const r = resumirVentas([
      venta({ total: 1000 }),
      venta({ total: 300, tipoComprobante: 'NOTA_CREDITO_A' }),
    ]);
    expect(r.totalCentavos).toBe(70_000);
  });

  it('las anuladas no suman pero sí se cuentan como listadas', () => {
    const r = resumirVentas([venta({ total: 1000 }), venta({ total: 999, estado: 'ANULADO' })]);
    expect(r.totalCentavos).toBe(100_000);
    expect(r.cantidad).toBe(2);
  });

  it('desglosa cuánto de eso ya está asignado (lo único que impacta el resultado)', () => {
    const r = resumirVentas([
      venta({ estado: 'ASIGNADO', total: 1000 }),
      venta({ estado: 'VALIDADO', total: 500 }),
    ]);
    expect(r.asignadoCentavos).toBe(100_000);
    expect(r.asignadas).toBe(1);
  });

  it('moneda extranjera se convierte con el tipo de cambio; sin TC queda fuera y se avisa', () => {
    const r = resumirVentas([
      venta({ total: 10, moneda: 'USD', tipoCambio: 1325.5 }),
      venta({ total: 10, moneda: 'USD', tipoCambio: null }),
    ]);
    expect(r.totalCentavos).toBe(1_325_500);
    expect(r.sinTipoCambio).toBe(1);
  });

  it('ignora ventas sin total', () => {
    const r = resumirVentas([venta({ total: null })]);
    expect(r.totalCentavos).toBe(0);
    expect(r.cantidad).toBe(1);
  });
});
