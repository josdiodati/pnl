import { describe, it, expect } from 'vitest';
import { plantillaQueCoincide, construirReglaDesdeAsignacion, reglaVigenteParaCuit, type EntradaReglaDesdeAsignacion } from '@/lib/reglas/desde-asignacion';

// Camino inverso al de lib/reglas/aplicar.ts: de una asignación concreta a una
// regla reutilizable. La restricción del modelo manda: ReglaAsignacion guarda un
// centro único al 100% O una plantilla de distribución, nunca líneas sueltas.

const unaLinea = [{ centroCostoId: 'cc-admin', clienteId: null, proyectoId: null, porcentaje: 100 }];
const reparto = [
  { centroCostoId: 'cc-bpo', clienteId: null, proyectoId: null, porcentaje: 60 },
  { centroCostoId: 'cc-admin', clienteId: null, proyectoId: null, porcentaje: 40 },
];

const base: EntradaReglaDesdeAsignacion = {
  cuit: '30656631615',
  razonSocial: 'AMX ARGENTINA SA',
  categoriaId: 'cat-telefonia',
  categoriaNombre: 'Telefonía',
  palabraClave: null,
  nombrePropuesto: null,
  lineas: unaLinea,
  plantillas: [],
};

describe('plantillaQueCoincide', () => {
  const plantillas = [
    { id: 'p1', lineas: reparto },
    { id: 'p2', lineas: unaLinea },
  ];

  it('encuentra la plantilla con las mismas líneas', () => {
    expect(plantillaQueCoincide(reparto, plantillas)).toBe('p1');
  });

  it('no depende del orden de las líneas', () => {
    expect(plantillaQueCoincide([reparto[1], reparto[0]], plantillas)).toBe('p1');
  });

  it('devuelve null si ningún reparto coincide', () => {
    const otro = [{ centroCostoId: 'cc-bpo', clienteId: null, proyectoId: null, porcentaje: 70 },
                  { centroCostoId: 'cc-admin', clienteId: null, proyectoId: null, porcentaje: 30 }];
    expect(plantillaQueCoincide(otro, plantillas)).toBeNull();
  });

  it('distingue por cliente y proyecto, no solo por centro', () => {
    const conCliente = [{ centroCostoId: 'cc-admin', clienteId: 'cli-1', proyectoId: null, porcentaje: 100 }];
    expect(plantillaQueCoincide(conCliente, plantillas)).toBeNull();
  });
});

describe('reglaVigenteParaCuit', () => {
  const reglas: { id: string; cuit: string | null; accion: string }[] = [
    { id: 'r1', cuit: '30-65663161-5', accion: 'ASIGNAR' },
    { id: 'r2', cuit: '30111111118', accion: 'OBSERVAR' },
    { id: 'r3', cuit: null, accion: 'ASIGNAR' },
  ];

  it('encuentra la regla del CUIT aunque venga con guiones', () => {
    expect(reglaVigenteParaCuit(reglas, '30656631615')?.id).toBe('r1');
  });

  it('ignora las reglas de descarte: no son una imputación que se pueda pisar', () => {
    expect(reglaVigenteParaCuit(reglas, '30111111118')).toBeNull();
  });

  it('sin CUIT no hay regla vigente', () => {
    expect(reglaVigenteParaCuit(reglas, null)).toBeNull();
  });
});

describe('construirReglaDesdeAsignacion', () => {
  it('una sola línea al 100% se guarda como centro directo', () => {
    const r = construirReglaDesdeAsignacion(base);
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({
      cuit: '30656631615',
      categoriaId: 'cat-telefonia',
      centroCostoId: 'cc-admin',
      clienteId: null,
      proyectoId: null,
      distribucionId: null,
    });
  });

  it('nombra la regla con la contraparte y la categoría', () => {
    const r = construirReglaDesdeAsignacion(base);
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla.nombre).toBe('AMX ARGENTINA SA → Telefonía');
  });

  it('respeta el nombre que escribió el usuario', () => {
    const r = construirReglaDesdeAsignacion({ ...base, nombrePropuesto: '  Claro móviles  ' });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla.nombre).toBe('Claro móviles');
  });

  it('un reparto que coincide con una plantilla se guarda como plantilla', () => {
    const r = construirReglaDesdeAsignacion({ ...base, lineas: reparto, plantillas: [{ id: 'p1', lineas: reparto }] });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({ distribucionId: 'p1', centroCostoId: null });
  });

  it('un reparto sin plantilla que lo represente NO se puede guardar', () => {
    const r = construirReglaDesdeAsignacion({ ...base, lineas: reparto, plantillas: [] });
    expect(r.crear).toBe(false);
    if (r.crear) throw new Error('no debería crear');
    expect(r.motivo).toMatch(/plantilla/i);
  });

  it('sin CUIT no hay condición posible', () => {
    const r = construirReglaDesdeAsignacion({ ...base, cuit: null });
    expect(r.crear).toBe(false);
  });

  it('sin líneas no hay asignación que replicar', () => {
    const r = construirReglaDesdeAsignacion({ ...base, lineas: [] });
    expect(r.crear).toBe(false);
  });

  it('guarda la palabra clave cuando se la pasan, y descarta la vacía', () => {
    const con = construirReglaDesdeAsignacion({ ...base, palabraClave: ' roaming ' });
    if (!con.crear) throw new Error(con.motivo);
    expect(con.regla.palabraClave).toBe('roaming');

    const sin = construirReglaDesdeAsignacion({ ...base, palabraClave: '   ' });
    if (!sin.crear) throw new Error(sin.motivo);
    expect(sin.regla.palabraClave).toBeNull();
  });

  it('conserva cliente y proyecto de la línea única', () => {
    const r = construirReglaDesdeAsignacion({
      ...base,
      lineas: [{ centroCostoId: 'cc-bpo', clienteId: 'cli-1', proyectoId: 'pry-1', porcentaje: 100 }],
    });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({ centroCostoId: 'cc-bpo', clienteId: 'cli-1', proyectoId: 'pry-1' });
  });
});
