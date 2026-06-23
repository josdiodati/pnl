import { describe, it, expect } from 'vitest';
import { puedeAsignar, tieneAsignacionCompleta } from '@/lib/movimientos/service';

describe('helpers de asignación', () => {
  it('puedeAsignar solo desde VALIDADO o ASIGNADO', () => {
    expect(puedeAsignar('VALIDADO')).toBe(true);
    expect(puedeAsignar('ASIGNADO')).toBe(true);
    expect(puedeAsignar('PENDIENTE_VALIDACION')).toBe(false);
  });
  it('tieneAsignacionCompleta exige categoría y líneas que suman 100', () => {
    expect(tieneAsignacionCompleta('cat1', [{ centroCostoId: 'cc', porcentaje: 100 }])).toBe(true);
    expect(tieneAsignacionCompleta(null, [{ centroCostoId: 'cc', porcentaje: 100 }])).toBe(false);
    expect(tieneAsignacionCompleta('cat1', [{ centroCostoId: 'cc', porcentaje: 50 }])).toBe(false);
    expect(tieneAsignacionCompleta('cat1', [])).toBe(false);
  });
});
