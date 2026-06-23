import { describe, it, expect } from 'vitest';
import { buildWhereMovimientos, ESTADOS_LIBRO } from '@/lib/movimientos/query';

const opts = { esValidador: true, usuarioId: 'u1' };

describe('buildWhereMovimientos — Movimientos es el libro (solo validado + asignado)', () => {
  it('sin filtro de estado, restringe a VALIDADO + ASIGNADO', () => {
    const where = buildWhereMovimientos({}, opts);
    expect(where.estado).toEqual({ in: ESTADOS_LIBRO });
  });

  it('un estado dentro del libro lo angosta a ese estado', () => {
    expect(buildWhereMovimientos({ estado: 'VALIDADO' }, opts).estado).toBe('VALIDADO');
    expect(buildWhereMovimientos({ estado: 'ASIGNADO' }, opts).estado).toBe('ASIGNADO');
  });

  it('un estado fuera del libro NO se respeta: cae al rango del libro', () => {
    for (const e of ['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'INGRESADO', 'ANULADO', 'ERROR_PROCESAMIENTO']) {
      expect(buildWhereMovimientos({ estado: e }, opts).estado).toEqual({ in: ESTADOS_LIBRO });
    }
  });
});
