import { describe, it, expect } from 'vitest';
import { resumirPorMes } from '@/lib/arca/mis-comprobantes/resumen-mensual';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('resumirPorMes', () => {
  it('agrupa por mes y origen, cuenta cruzados y calcula el cumplimiento; meses recientes primero', () => {
    const r = resumirPorMes([
      { fechaEmision: d('2026-08-05'), origen: 'RECIBIDO', movimientoId: 'm1' },
      { fechaEmision: d('2026-08-20'), origen: 'RECIBIDO', movimientoId: null },
      { fechaEmision: d('2026-08-31'), origen: 'EMITIDO', movimientoId: 'm2' },
      { fechaEmision: d('2026-09-01'), origen: 'EMITIDO', movimientoId: null },
    ]);
    expect(r.map((m) => m.mes)).toEqual(['2026-09', '2026-08']);
    expect(r[1]).toEqual({
      mes: '2026-08', emitidos: { total: 1, cruzados: 1 }, recibidos: { total: 2, cruzados: 1 }, total: 3, cruzados: 2, faltan: 1, pct: 67,
    });
    expect(r[0]).toMatchObject({ total: 1, cruzados: 0, faltan: 1, pct: 0 });
  });
  it('sin filas, lista vacía', () => {
    expect(resumirPorMes([])).toEqual([]);
  });
});
