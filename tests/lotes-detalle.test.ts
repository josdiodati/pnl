import { describe, it, expect } from 'vitest';
import { detalleLote } from '@/lib/movimientos/lotes';

// El desplegable de cada lote en /carga lista sus comprobantes en el mismo
// orden que los chips de resultado, con lo que sigue en proceso al final.
describe('detalleLote', () => {
  it('anota el resultado de cada comprobante y los ordena como los chips', () => {
    const movs = [
      { id: 'a', estado: 'ASIGNADO', flags: null },
      { id: 'b', estado: 'PROCESANDO', flags: null },
      { id: 'c', estado: 'PENDIENTE_VALIDACION', flags: null },
      { id: 'd', estado: 'VALIDADO', flags: null },
      { id: 'e', estado: 'DUPLICADO', flags: { duplicadoArchivo: 'x' } },
      { id: 'f', estado: 'ASIGNADO', flags: null },
    ];
    expect(detalleLote(movs).map((d) => [d.mov.id, d.clave])).toEqual([
      ['c', 'pendientes'],
      ['d', 'auto-validados'],
      ['a', 'auto-asignados'],
      ['f', 'auto-asignados'],
      ['e', 'archivo-duplicado'],
      ['b', null],
    ]);
  });

  it('distingue lo que hizo el pipeline de lo que hizo una persona', () => {
    const movs = [
      { id: 'a', estado: 'ASIGNADO', flags: null, auto: 'AUTO_ASIGNAR' as const },
      { id: 'b', estado: 'ASIGNADO', flags: null, auto: 'AUTO_VALIDAR' as const },
      { id: 'c', estado: 'ASIGNADO', flags: null, auto: null },
      { id: 'd', estado: 'VALIDADO', flags: null, auto: 'AUTO_VALIDAR' as const },
      { id: 'e', estado: 'VALIDADO', flags: null, auto: null },
    ];
    expect(detalleLote(movs).map((d) => [d.mov.id, d.clave])).toEqual([
      ['d', 'auto-validados'],
      ['a', 'auto-asignados'],
      ['e', 'validados'],
      ['b', 'asignados'],
      ['c', 'asignados'],
    ]);
  });
});
