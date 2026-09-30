import { describe, it, expect } from 'vitest';
import { resumirPorMes } from '@/lib/arca/mis-comprobantes/resumen-mensual';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('resumirPorMes', () => {
  it('agrupa por mes y origen, cuenta cruzados y calcula el cumplimiento; meses recientes primero', () => {
    const r = resumirPorMes([
      { fechaEmision: d('2026-08-05'), origen: 'RECIBIDO', movimientoId: 'm1', ignoradoAt: null },
      { fechaEmision: d('2026-08-20'), origen: 'RECIBIDO', movimientoId: null, ignoradoAt: null },
      { fechaEmision: d('2026-08-31'), origen: 'EMITIDO', movimientoId: 'm2', ignoradoAt: null },
      { fechaEmision: d('2026-09-01'), origen: 'EMITIDO', movimientoId: null, ignoradoAt: null },
    ]);
    expect(r.map((m) => m.mes)).toEqual(['2026-09', '2026-08']);
    expect(r[1]).toEqual({
      mes: '2026-08', emitidos: { total: 1, cruzados: 1, ignorados: 0 }, recibidos: { total: 2, cruzados: 1, ignorados: 0 }, total: 3, cruzados: 2, ignorados: 0, faltan: 1, pct: 67,
    });
    expect(r[0]).toMatchObject({ total: 1, cruzados: 0, faltan: 1, pct: 0 });
  });
  it('los ignorados cuentan para el cumplimiento (el mes puede cerrar al 100%) y no como faltantes', () => {
    const r = resumirPorMes([
      { fechaEmision: d('2026-08-05'), origen: 'RECIBIDO', movimientoId: 'm1', ignoradoAt: null },
      { fechaEmision: d('2026-08-20'), origen: 'RECIBIDO', movimientoId: null, ignoradoAt: d('2026-09-30') },
      { fechaEmision: d('2026-08-21'), origen: 'RECIBIDO', movimientoId: null, ignoradoAt: null },
    ]);
    expect(r[0]).toMatchObject({ recibidos: { total: 3, cruzados: 1, ignorados: 1 }, total: 3, cruzados: 1, ignorados: 1, faltan: 1, pct: 67 });
    const completo = resumirPorMes([
      { fechaEmision: d('2026-08-05'), origen: 'RECIBIDO', movimientoId: 'm1', ignoradoAt: null },
      { fechaEmision: d('2026-08-20'), origen: 'RECIBIDO', movimientoId: null, ignoradoAt: d('2026-09-30') },
    ]);
    expect(completo[0]).toMatchObject({ faltan: 0, pct: 100, ignorados: 1 });
  });
  it('sin filas, lista vacía', () => {
    expect(resumirPorMes([])).toEqual([]);
  });
});
