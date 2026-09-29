import { describe, it, expect } from 'vitest';
import { CATALOGO, reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { puedeVerReporte, diffHabilitaciones, parsearGrilla, type Par } from '@/lib/reportes-personalizados/habilitaciones';
import { agruparGastoPorProveedor, type CompraAgrupable } from '@/lib/reportes-personalizados/gasto-por-proveedor';

const ID = 'gasto-por-proveedor'; // del catálogo, rol mínimo VALIDADOR

describe('catálogo de reportes personalizados', () => {
  it('ids únicos y con formato slug', () => {
    const ids = CATALOGO.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('cada reporte tiene título y descripción', () => {
    for (const r of CATALOGO) {
      expect(r.titulo.trim()).not.toBe('');
      expect(r.descripcion.trim()).not.toBe('');
    }
  });

  it('busca por id', () => {
    expect(reporteDelCatalogo(ID)?.rolMinimo).toBe('VALIDADOR');
    expect(reporteDelCatalogo('no-existe')).toBeUndefined();
  });
});

describe('puedeVerReporte', () => {
  it('sin habilitación no ve', () => {
    expect(puedeVerReporte(ID, 'ADMINISTRADOR', new Set())).toBe(false);
  });
  it('habilitado pero con rol inferior al mínimo no ve', () => {
    expect(puedeVerReporte(ID, 'CARGADOR', new Set([ID]))).toBe(false);
  });
  it('reporte fuera del catálogo no se ve aunque haya fila', () => {
    expect(puedeVerReporte('viejo', 'ADMINISTRADOR', new Set(['viejo']))).toBe(false);
  });
  it('habilitado y con rol suficiente ve', () => {
    expect(puedeVerReporte(ID, 'VALIDADOR', new Set([ID]))).toBe(true);
    expect(puedeVerReporte(ID, 'ADMINISTRADOR', new Set([ID]))).toBe(true);
  });
});

describe('diffHabilitaciones', () => {
  const p = (usuarioId: string, reporteId = ID): Par => ({ usuarioId, reporteId });
  const todoValido = () => true;

  it('altas y bajas', () => {
    const r = diffHabilitaciones([p('a'), p('b')], [p('b'), p('c')], todoValido);
    expect(r.altas).toEqual([p('c')]);
    expect(r.bajas).toEqual([p('a')]);
  });

  it('sin cambios', () => {
    const r = diffHabilitaciones([p('a')], [p('a')], todoValido);
    expect(r).toEqual({ altas: [], bajas: [] });
  });

  // valido() en producción exige reporte en catálogo, así que una huérfana
  // nunca es válida.
  const validoSiCatalogo = (x: Par) => x.reporteId === ID;

  it('las filas de reportes fuera del catálogo quedan intactas', () => {
    const r = diffHabilitaciones([p('a', 'viejo')], [], validoSiCatalogo);
    expect(r.bajas).toEqual([]);
  });

  it('a quien le bajaron el rol (casilla deshabilitada, no viaja) no se le borra la fila', () => {
    const r = diffHabilitaciones([p('a'), p('b')], [], (x) => x.usuarioId === 'b');
    expect(r.bajas).toEqual([p('b')]);
  });

  it('no duplica altas si el form repite un par', () => {
    const r = diffHabilitaciones([], [p('a'), p('a')], todoValido);
    expect(r.altas).toEqual([p('a')]);
  });

  it('descarta altas inválidas (rol insuficiente, no miembro, fuera de catálogo)', () => {
    const r = diffHabilitaciones([], [p('a'), p('b'), p('c', 'viejo')], (x) => x.usuarioId === 'a');
    expect(r.altas).toEqual([p('a')]);
  });

  it('un par existente que dejó de ser válido y viaja marcado (form manipulado) no cambia', () => {
    const r = diffHabilitaciones([p('a')], [p('a')], () => false);
    expect(r).toEqual({ altas: [], bajas: [] });
  });
});

describe('parsearGrilla', () => {
  it('lee los checkboxes h:<reporteId>:<usuarioId> e ignora el resto', () => {
    const fd = new FormData();
    fd.set('empresaSlug', 'ewwo');
    fd.set(`h:${ID}:u1`, 'on');
    fd.set(`h:${ID}:u2`, 'on');
    fd.set('h:malformado', 'on');
    expect(parsearGrilla(fd)).toEqual([
      { reporteId: ID, usuarioId: 'u1' },
      { reporteId: ID, usuarioId: 'u2' },
    ]);
  });
});

describe('agruparGastoPorProveedor', () => {
  const compra = (contraparteId: string | null, total: number, over: Partial<CompraAgrupable> = {}): CompraAgrupable => ({
    contraparteId,
    cuitEmisor: null,
    proveedor: contraparteId ? `Prov ${contraparteId}` : 'ACME (sin identificar)',
    moneda: 'ARS',
    tipoCambio: null,
    tipoComprobante: 'FACTURA_A',
    total,
    iva21: 0, iva105: 0, iva27: 0, percepcionesIva: 0, percepcionesIibb: 0, otrosTributos: 0,
    ...over,
  });

  it('neto = total − IVA − percepciones − otros, agrupado y ordenado', () => {
    const r = agruparGastoPorProveedor([
      compra('a', 121, { iva21: 21 }),
      compra('b', 500),
      compra('a', 100),
    ]);
    expect(r.filas.map((f) => [f.contraparteId, f.cantidad, f.netoArs])).toEqual([
      ['b', 1, 500],
      ['a', 2, 200],
    ]);
    expect(r.total).toEqual({ cantidad: 3, netoArs: 700 });
    expect(r.filas[0].pct).toBeCloseTo(500 / 700);
    expect(r.resto).toBeNull();
  });

  it('top N + resto', () => {
    const r = agruparGastoPorProveedor([compra('a', 300), compra('b', 200), compra('c', 100), compra('d', 50)], 2);
    expect(r.filas.map((f) => f.contraparteId)).toEqual(['a', 'b']);
    expect(r.resto).toEqual({ proveedores: 2, cantidad: 2, netoArs: 150 });
    expect(r.total.netoArs).toBe(650);
  });

  it('nota de crédito resta', () => {
    const r = agruparGastoPorProveedor([compra('a', 1000), compra('a', 200, { tipoComprobante: 'NOTA_CREDITO_A' })]);
    expect(r.filas[0].netoArs).toBe(800);
  });

  it('pesifica moneda extranjera y cuenta aparte la que no tiene tipo de cambio', () => {
    const r = agruparGastoPorProveedor([
      compra('a', 10, { moneda: 'USD', tipoCambio: 1000 }),
      compra('a', 10, { moneda: 'USD', tipoCambio: null }),
    ]);
    expect(r.filas[0].netoArs).toBe(10000);
    expect(r.filas[0].cantidad).toBe(1);
    expect(r.sinTipoCambio).toBe(1);
  });

  it('sin contraparte: agrupa por CUIT emisor con el nombre del documento', () => {
    const r = agruparGastoPorProveedor([
      compra(null, 10, { cuitEmisor: '30712093486', proveedor: 'ACME SA' }),
      compra(null, 20, { cuitEmisor: '30712093486', proveedor: 'ACME S.A.' }),
      compra(null, 5, { cuitEmisor: '20111111112', proveedor: 'Otro' }),
    ]);
    expect(r.filas.map((f) => [f.contraparteId, f.cuit, f.proveedor, f.cantidad, f.netoArs])).toEqual([
      [null, '30712093486', 'ACME SA', 2, 30],
      [null, '20111111112', 'Otro', 1, 5],
    ]);
  });

  it('sin contraparte ni CUIT: una sola fila "Sin identificar"', () => {
    const r = agruparGastoPorProveedor([compra(null, 10, { proveedor: '' }), compra(null, 20, { proveedor: 'X' })]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ contraparteId: null, cuit: null, proveedor: 'Sin identificar', cantidad: 2, netoArs: 30 });
  });

  it('con contraparte, el CUIT extraído no separa grupos', () => {
    const r = agruparGastoPorProveedor([compra('a', 10, { cuitEmisor: '1' }), compra('a', 10, { cuitEmisor: '2' })]);
    expect(r.filas).toHaveLength(1);
  });
});
