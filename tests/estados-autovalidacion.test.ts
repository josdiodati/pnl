import { describe, it, expect } from 'vitest';
import { puedeTransicionar } from '@/lib/movimientos/estados';

describe('PROCESANDO autovalidación', () => {
  it('permite PROCESANDO→VALIDADO y PROCESANDO→ASIGNADO', () => {
    expect(puedeTransicionar('PROCESANDO', 'VALIDADO')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'ASIGNADO')).toBe(true);
  });
  it('mantiene los destinos previos de PROCESANDO', () => {
    expect(puedeTransicionar('PROCESANDO', 'PENDIENTE_VALIDACION')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'RETENIDO')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'ERROR_PROCESAMIENTO')).toBe(true);
  });
});
