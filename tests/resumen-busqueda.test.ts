import { describe, it, expect } from 'vitest';
import { buildWhereMovimientoConciliable, MOVIMIENTOS_CONCILIABLES } from '@/lib/resumenes/busqueda';

// Buscador del panel de conciliación: texto libre sobre los movimientos en
// estado conciliable. Los que ya tienen una línea vinculada aparecen (pago
// parcial, con confirmación); los nacidos de una imputación no.
describe('buildWhereMovimientoConciliable', () => {
  const where = buildWhereMovimientoConciliable('acme');

  it('sólo estados conciliables', () => {
    expect(where.estado).toEqual({ in: [...MOVIMIENTOS_CONCILIABLES] });
    expect(MOVIMIENTOS_CONCILIABLES).toContain('ASIGNADO');
  });

  it('excluye sólo los movimientos nacidos de una imputación (los conciliados se pueden compartir)', () => {
    expect(where.vinculosResumen).toEqual({ none: { linea: { estado: 'IMPUTADA' } } });
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
