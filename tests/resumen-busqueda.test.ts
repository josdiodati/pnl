import { describe, it, expect } from 'vitest';
import { buildWhereMovimientoConciliable, MOVIMIENTOS_CONCILIABLES } from '@/lib/resumenes/busqueda';

// Buscador del panel de conciliación: texto libre sobre los movimientos que
// todavía se pueden conciliar (estados conciliables y sin línea de resumen ya
// conciliada/imputada encima).
describe('buildWhereMovimientoConciliable', () => {
  const where = buildWhereMovimientoConciliable('acme');

  it('sólo estados conciliables', () => {
    expect(where.estado).toEqual({ in: [...MOVIMIENTOS_CONCILIABLES] });
    expect(MOVIMIENTOS_CONCILIABLES).toContain('ASIGNADO');
  });

  it('excluye movimientos ya usados por otra línea de resumen', () => {
    expect(where.lineasResumen).toEqual({ none: { estado: { in: ['CONCILIADA', 'IMPUTADA'] } } });
  });

  it('busca el texto en contraparte, descripción, número y cuit', () => {
    const contains = { contains: 'acme', mode: 'insensitive' };
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { descripcion: contains },
        { numero: contains },
        { cuitEmisor: contains },
        { contraparte: { razonSocial: contains } },
        { contraparte: { cuit: contains } },
      ]),
    );
  });

  it('sin texto no agrega OR (lista los más recientes)', () => {
    expect(buildWhereMovimientoConciliable('').OR).toBeUndefined();
    expect(buildWhereMovimientoConciliable('  ').OR).toBeUndefined();
  });
});
