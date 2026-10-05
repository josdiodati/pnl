import { describe, it, expect } from 'vitest';
import { aplicarEjercicio } from '@/lib/movimientos/query';

// Movimientos muestra por defecto el ejercicio corriente de la empresa (según
// su mes de inicio); el filtro `ejercicio` elige otro o 'todos'.
describe('aplicarEjercicio', () => {
  const hoy = new Date('2026-10-05T12:00:00Z');

  it('sin parámetros toma el ejercicio corriente (inicio julio)', () => {
    const r = aplicarEjercicio({}, 7, hoy);
    expect(r.ejercicio).toBe(2026);
    expect(r.filtros.desde).toBe('2026-07-01');
    expect(r.filtros.hasta).toBe('2027-06-30');
  });

  it('respeta el mes de inicio de cada empresa', () => {
    expect(aplicarEjercicio({}, 1, hoy).filtros).toMatchObject({ desde: '2026-01-01', hasta: '2026-12-31' });
    // Inicio noviembre: octubre 2026 cae en el ejercicio que arrancó nov 2025
    const r = aplicarEjercicio({}, 11, hoy);
    expect(r.ejercicio).toBe(2025);
    expect(r.filtros).toMatchObject({ desde: '2025-11-01', hasta: '2026-10-31' });
  });

  it('ejercicio explícito elige otro año', () => {
    const r = aplicarEjercicio({ ejercicio: '2025' }, 7, hoy);
    expect(r.ejercicio).toBe(2025);
    expect(r.filtros).toMatchObject({ desde: '2025-07-01', hasta: '2026-06-30' });
  });

  it("'todos' no restringe fechas", () => {
    const r = aplicarEjercicio({ ejercicio: 'todos', desde: '2024-01-01' }, 7, hoy);
    expect(r.ejercicio).toBeNull();
    expect(r.filtros.desde).toBe('2024-01-01');
    expect(r.filtros.hasta).toBeUndefined();
  });

  it('con fechas sueltas y sin ejercicio (drill-down) no fuerza el corriente', () => {
    const r = aplicarEjercicio({ desde: '2025-08-01', hasta: '2025-08-31' }, 7, hoy);
    expect(r.ejercicio).toBeNull();
    expect(r.filtros).toMatchObject({ desde: '2025-08-01', hasta: '2025-08-31' });
  });

  it('ejercicio + fechas: se intersectan', () => {
    const r = aplicarEjercicio({ ejercicio: '2026', desde: '2026-09-01', hasta: '2028-01-01' }, 7, hoy);
    expect(r.filtros).toMatchObject({ desde: '2026-09-01', hasta: '2027-06-30' });
  });

  it('un ejercicio inválido cae al corriente', () => {
    expect(aplicarEjercicio({ ejercicio: 'abc' }, 7, hoy).ejercicio).toBe(2026);
  });
});
