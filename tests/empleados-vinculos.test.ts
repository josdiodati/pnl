import { describe, it, expect } from 'vitest';
import { validarMontoVinculo } from '@/lib/empleados/service';

describe('validarMontoVinculo', () => {
  it('acepta un vínculo que entra en el total', () => {
    expect(() => validarMontoVinculo(100_000, 0, 30_000)).not.toThrow();
    expect(() => validarMontoVinculo(100_000, 70_000, 30_000)).not.toThrow(); // cubre justo el total
  });

  it('rechaza monto no positivo', () => {
    expect(() => validarMontoVinculo(100_000, 0, 0)).toThrow(/mayor a 0/);
    expect(() => validarMontoVinculo(100_000, 0, -5)).toThrow(/mayor a 0/);
  });

  it('rechaza cuando la suma de vínculos supera el total del movimiento', () => {
    expect(() => validarMontoVinculo(100_000, 80_000, 30_000)).toThrow(/supera/);
  });
});
