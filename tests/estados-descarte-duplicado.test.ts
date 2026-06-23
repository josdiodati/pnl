import { describe, it, expect } from 'vitest';
import { puedeTransicionar, bloqueaCierre } from '@/lib/movimientos/estados';

describe('descarte por regla (OBSERVADO) y duplicado (DUPLICADO)', () => {
  it('PROCESANDO puede ir a OBSERVADO y a DUPLICADO', () => {
    expect(puedeTransicionar('PROCESANDO', 'OBSERVADO')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'DUPLICADO')).toBe(true);
  });
  it('PENDIENTE_VALIDACION puede ir a DUPLICADO (confirmación tardía por ARCA)', () => {
    expect(puedeTransicionar('PENDIENTE_VALIDACION', 'DUPLICADO')).toBe(true);
  });
  it('DUPLICADO se puede recuperar a pendiente o anular', () => {
    expect(puedeTransicionar('DUPLICADO', 'PENDIENTE_VALIDACION')).toBe(true);
    expect(puedeTransicionar('DUPLICADO', 'ANULADO')).toBe(true);
  });
  it('DUPLICADO no impacta y NO bloquea el cierre; OBSERVADO sí bloquea', () => {
    expect(bloqueaCierre('DUPLICADO')).toBe(false);
    expect(bloqueaCierre('OBSERVADO')).toBe(true);
  });
});
