import { describe, it, expect } from 'vitest';
import { CATALOGO, reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { puedeVerReporte, diffHabilitaciones, parsearGrilla, type Par } from '@/lib/reportes-personalizados/habilitaciones';

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
