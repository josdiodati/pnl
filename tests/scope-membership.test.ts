import { describe, it, expect } from 'vitest';
import { SCOPED_MODELS } from '@/lib/empresa/scope';

// Guard: ensure empresa-scoped models include the critical per-empresa entities.
// If either is missing, cross-company data leaks become possible.
describe('SCOPED_MODELS membership', () => {
  it('includes Cliente', () => {
    expect(SCOPED_MODELS.has('Cliente')).toBe(true);
  });

  it('includes Proyecto', () => {
    expect(SCOPED_MODELS.has('Proyecto')).toBe(true);
  });

  it('ReglaAsignacion es empresa-scoped', () => {
    expect(SCOPED_MODELS.has('ReglaAsignacion')).toBe(true);
  });
});
