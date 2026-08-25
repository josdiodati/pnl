import { describe, it, expect } from 'vitest';
import { decidirEstadoRecibo } from '@/lib/empleados/decision';

const base = { camposRevisar: {}, tieneDistribucion: true, periodoCerrado: false, duplicado: false };

describe('decidirEstadoRecibo', () => {
  it('caso feliz: aritmética cierra + ficha con distribución → CONFIRMADO directo', () => {
    expect(decidirEstadoRecibo(base)).toEqual({ estado: 'CONFIRMADO', nota: null });
  });

  it('duplicado → ANULADO con nota, gana sobre todo lo demás', () => {
    const r = decidirEstadoRecibo({ ...base, duplicado: true, periodoCerrado: true });
    expect(r.estado).toBe('ANULADO');
    expect(r.nota).toMatch(/duplicado/i);
  });

  it('período cerrado → PENDIENTE_REVISION con nota (nunca entra solo a un mes cerrado)', () => {
    const r = decidirEstadoRecibo({ ...base, periodoCerrado: true });
    expect(r.estado).toBe('PENDIENTE_REVISION');
    expect(r.nota).toMatch(/cerrado/i);
  });

  it('campos flaggeados → PENDIENTE_REVISION', () => {
    expect(decidirEstadoRecibo({ ...base, camposRevisar: { sueldoNeto: 'no cierra' } }).estado).toBe('PENDIENTE_REVISION');
  });

  it('empleado sin distribución → PENDIENTE_REVISION', () => {
    expect(decidirEstadoRecibo({ ...base, tieneDistribucion: false }).estado).toBe('PENDIENTE_REVISION');
  });
});
