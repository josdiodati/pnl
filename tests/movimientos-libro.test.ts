import { describe, it, expect } from 'vitest';
import { buildWhereMovimientos, ESTADOS_LIBRO, tonoImporte, resumirMovimientos, type MovimientoConRelaciones } from '@/lib/movimientos/query';

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

// Drill-down del reporte por proyecto: el libro filtra por línea de asignación.
// 'sin' es el valor reservado para "líneas sin proyecto".
describe('buildWhereMovimientos — filtro por proyecto', () => {
  it('filtra los movimientos con alguna línea del proyecto', () => {
    expect(buildWhereMovimientos({ proyectoId: 'p1' }, opts).lineas).toEqual({ some: { proyectoId: 'p1' } });
  });

  it("'sin' filtra las líneas sin proyecto", () => {
    expect(buildWhereMovimientos({ proyectoId: 'sin' }, opts).lineas).toEqual({ some: { proyectoId: null } });
  });
});

describe('resumirMovimientos — desglose por proyecto', () => {
  const mov: MovimientoConRelaciones = {
    id: 'm1',
    estado: 'ASIGNADO',
    total: 100,
    tipoComprobante: 'FACTURA_A',
    categoria: { tipo: 'EGRESO', nombre: 'Servicios' },
    lineas: [
      { centroCostoId: 'cc1', clienteId: 'cliA', proyectoId: 'p1', porcentaje: 60 },
      { centroCostoId: 'cc1', clienteId: null, proyectoId: null, porcentaje: 40 },
    ],
  };

  it('suma en porProyecto sólo las líneas con proyecto', () => {
    const r = resumirMovimientos([mov]);
    expect(r.porProyecto.get('p1')).toBe(-6_000);
    expect(r.porProyecto.size).toBe(1);
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
