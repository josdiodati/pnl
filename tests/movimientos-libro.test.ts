import { describe, it, expect } from 'vitest';
import { buildWhereMovimientos, ESTADOS_LIBRO, tonoImporte } from '@/lib/movimientos/query';

const opts = { esValidador: true, usuarioId: 'u1' };

// El libro muestra sólo ASIGNADO: es exactamente lo que impacta el resultado, y
// lo que sus propios totales suman (resumirMovimientos ya contaba sólo asignados).
// Un validado-sin-imputar vive en la cola de Asignación, no acá.
describe('buildWhereMovimientos — Movimientos es el libro (sólo asignados)', () => {
  it('restringe a ASIGNADO', () => {
    expect(buildWhereMovimientos({}, opts).estado).toEqual({ in: ESTADOS_LIBRO });
    expect([...ESTADOS_LIBRO]).toEqual(['ASIGNADO']);
  });

  it('ningún filtro de estado puede ampliar el rango del libro', () => {
    for (const e of ['VALIDADO', 'PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'INGRESADO', 'ANULADO', 'ERROR_PROCESAMIENTO']) {
      expect(buildWhereMovimientos({ estado: e }, opts).estado).toEqual({ in: ESTADOS_LIBRO });
    }
  });
});

// Un comprobante validado pero sin imputar no tiene signo: el signo lo define la
// categoría. Pintarlo de verde lo hace leer como un ingreso, y en un libro de
// facturas de proveedores eso es lo contrario de la verdad.
describe('color del importe en el libro', () => {
  it('sin categoría el importe es neutro, nunca ingreso', () => {
    expect(tonoImporte(null)).toBe('sin-signo');
  });

  it('negativo es egreso y positivo es ingreso', () => {
    expect(tonoImporte(-1234)).toBe('egreso');
    expect(tonoImporte(5678)).toBe('ingreso');
  });

  it('cero cuenta como ingreso, no como indefinido', () => {
    expect(tonoImporte(0)).toBe('ingreso');
  });
});
