import { describe, it, expect } from 'vitest';
import { plantillaQueCoincide, construirReglaDesdeAsignacion, reglaVigenteParaCuit, reglaVigenteParaPalabraClave, reglaEquivalente, prioridadParaEspecifica, canalRegla, reglasDelCuit, describirCondiciones, type EntradaReglaDesdeAsignacion } from '@/lib/reglas/desde-asignacion';

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

describe('reglaVigenteParaPalabraClave (pisar reglas sin CUIT)', () => {
  const reglas: { id: string; cuit: string | null; palabraClave: string | null; accion: string }[] = [
    { id: 'r1', cuit: '30656631615', palabraClave: 'roaming', accion: 'ASIGNAR' },
    { id: 'r2', cuit: null, palabraClave: 'Max plan', accion: 'ASIGNAR' },
    { id: 'r3', cuit: null, palabraClave: 'spotify', accion: 'OBSERVAR' },
  ];

  it('encuentra la regla sin CUIT con la misma palabra clave, sin distinguir mayúsculas', () => {
    expect(reglaVigenteParaPalabraClave(reglas, 'max PLAN')?.id).toBe('r2');
  });

  it('ignora las reglas que además tienen CUIT: esas se pisan por CUIT', () => {
    expect(reglaVigenteParaPalabraClave(reglas, 'roaming')).toBeNull();
  });

  it('ignora las reglas de descarte', () => {
    expect(reglaVigenteParaPalabraClave(reglas, 'spotify')).toBeNull();
  });

  it('sin palabra clave no hay regla vigente', () => {
    expect(reglaVigenteParaPalabraClave(reglas, null)).toBeNull();
    expect(reglaVigenteParaPalabraClave(reglas, '  ')).toBeNull();
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

  it('sin CUIT ni palabra clave no hay condición posible', () => {
    const r = construirReglaDesdeAsignacion({ ...base, cuit: null, razonSocial: null });
    expect(r.crear).toBe(false);
    if (r.crear) throw new Error('no debería crear');
    expect(r.motivo).toMatch(/palabra clave/i);
  });

  // Comprobantes sin CUIT (suscripciones del exterior, tickets): la regla se
  // define por palabra clave, que el motor de matching ya soporta.
  it('sin CUIT pero con palabra clave crea la regla por palabra clave', () => {
    const r = construirReglaDesdeAsignacion({ ...base, cuit: null, palabraClave: 'Max plan' });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({ cuit: null, palabraClave: 'Max plan', categoriaId: 'cat-telefonia', centroCostoId: 'cc-admin' });
  });

  it('sin CUIT ni razón social, el nombre por defecto usa la palabra clave', () => {
    const r = construirReglaDesdeAsignacion({ ...base, cuit: null, razonSocial: null, palabraClave: 'Max plan' });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla.nombre).toBe('Max plan → Telefonía');
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

// Fuente (canal) y usuario como condiciones extra desde el atajo. Sin ellas
// todo sigue igual: la regla sólo evalúa las condiciones que tiene.
describe('construirReglaDesdeAsignacion con fuente y usuario', () => {
  it('sin fuente ni usuario la regla los deja en null', () => {
    const r = construirReglaDesdeAsignacion(base);
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({ canal: null, cargadoPorId: null });
  });

  it('guarda fuente y usuario cuando se los pasan, descartando vacíos', () => {
    const r = construirReglaDesdeAsignacion({ ...base, canal: 'FOTO', cargadoPorId: ' u-gaston ' });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla).toMatchObject({ canal: 'FOTO', cargadoPorId: 'u-gaston' });
    const vacio = construirReglaDesdeAsignacion({ ...base, canal: '', cargadoPorId: '  ' });
    if (!vacio.crear) throw new Error(vacio.motivo);
    expect(vacio.regla).toMatchObject({ canal: null, cargadoPorId: null });
  });

  it('fuente o usuario solos NO alcanzan como condición: sigue haciendo falta CUIT o palabra clave', () => {
    const r = construirReglaDesdeAsignacion({ ...base, cuit: null, razonSocial: null, canal: 'FOTO', cargadoPorId: 'u-1' });
    expect(r.crear).toBe(false);
  });
});

describe('reglaEquivalente (qué regla se pisa al guardar desde el atajo)', () => {
  type R = { id: string; cuit: string | null; palabraClave: string | null; canal: string | null; cargadoPorId: string | null; accion: string; prioridad: number };
  const reglas: R[] = [
    { id: 'amplia', cuit: '30-65663161-5', palabraClave: null, canal: null, cargadoPorId: null, accion: 'ASIGNAR', prioridad: 100 },
    { id: 'foto', cuit: '30656631615', palabraClave: null, canal: 'FOTO', cargadoPorId: null, accion: 'ASIGNAR', prioridad: 90 },
    { id: 'gaston-foto', cuit: '30656631615', palabraClave: null, canal: 'FOTO', cargadoPorId: 'u-gaston', accion: 'ASIGNAR', prioridad: 80 },
    { id: 'maxplan', cuit: null, palabraClave: 'Max plan', canal: null, cargadoPorId: null, accion: 'ASIGNAR', prioridad: 100 },
    { id: 'maxplan-mail', cuit: null, palabraClave: 'max plan', canal: 'EMAIL', cargadoPorId: null, accion: 'ASIGNAR', prioridad: 100 },
    { id: 'descarte', cuit: '30656631615', palabraClave: null, canal: null, cargadoPorId: null, accion: 'OBSERVAR', prioridad: 1 },
  ];
  const nueva = (p: Partial<R>) => ({ cuit: null, palabraClave: null, canal: null, cargadoPorId: null, ...p });

  it('misma combinación de CUIT + fuente + usuario → esa regla', () => {
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615' }))?.id).toBe('amplia');
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615', canal: 'FOTO' }))?.id).toBe('foto');
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615', canal: 'FOTO', cargadoPorId: 'u-gaston' }))?.id).toBe('gaston-foto');
  });

  it('una combinación más específica que no existe todavía no pisa la amplia', () => {
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615', cargadoPorId: 'u-gaston' }))).toBeNull();
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615', canal: 'EMAIL' }))).toBeNull();
  });

  it('sin CUIT compara por palabra clave (sin mayúsculas) + fuente + usuario', () => {
    expect(reglaEquivalente(reglas, nueva({ palabraClave: 'MAX PLAN' }))?.id).toBe('maxplan');
    expect(reglaEquivalente(reglas, nueva({ palabraClave: 'max plan', canal: 'EMAIL' }))?.id).toBe('maxplan-mail');
    expect(reglaEquivalente(reglas, nueva({ palabraClave: 'max plan', canal: 'FOTO' }))).toBeNull();
  });

  it('con CUIT la palabra clave también distingue: otra palabra clave es otra regla', () => {
    expect(reglaEquivalente(reglas, nueva({ cuit: '30656631615', palabraClave: 'roaming' }))).toBeNull();
    const conRoaming = [...reglas, { id: 'roaming', cuit: '30656631615', palabraClave: 'Roaming', canal: null, cargadoPorId: null, accion: 'ASIGNAR', prioridad: 100 }];
    expect(reglaEquivalente(conRoaming, nueva({ cuit: '30656631615', palabraClave: 'roaming' }))?.id).toBe('roaming');
    expect(reglaEquivalente(conRoaming, nueva({ cuit: '30656631615' }))?.id).toBe('amplia');
  });

  it('nunca devuelve una regla de descarte', () => {
    expect(reglaEquivalente([reglas[5]], nueva({ cuit: '30656631615' }))).toBeNull();
  });

  it('prioridad: una regla nueva más específica se evalúa antes que las menos específicas del mismo CUIT', () => {
    // sólo la amplia (p100) es menos específica que "usuario" → 90
    expect(prioridadParaEspecifica(reglas, nueva({ cuit: '30656631615', cargadoPorId: 'u-gaston' }))).toBe(90);
    // "foto + usuario + palabra" tiene por debajo a amplia (100), foto (90) y gaston-foto (80) → 70
    expect(prioridadParaEspecifica(reglas, nueva({ cuit: '30656631615', canal: 'FOTO', cargadoPorId: 'u-gaston', palabraClave: 'roaming' }))).toBe(70);
    // la palabra clave también cuenta como condición extra con CUIT
    expect(prioridadParaEspecifica(reglas, nueva({ cuit: '30656631615', palabraClave: 'roaming' }))).toBe(90);
    // sin condición extra no hay nada que adelantar
    expect(prioridadParaEspecifica(reglas, nueva({ cuit: '30656631615' }))).toBeNull();
    // sin CUIT: adelanta a la regla amplia de la misma palabra clave
    expect(prioridadParaEspecifica(reglas, nueva({ palabraClave: 'max plan', canal: 'FOTO' }))).toBe(90);
    // sin regla amplia que adelantar
    expect(prioridadParaEspecifica(reglas, nueva({ cuit: '30111111118', canal: 'FOTO' }))).toBeNull();
  });

  it('reglasDelCuit lista todas las de imputación del CUIT, por prioridad, sin descartes', () => {
    expect(reglasDelCuit(reglas, '30-65663161-5').map((r) => r.id)).toEqual(['gaston-foto', 'foto', 'amplia']);
    expect(reglasDelCuit(reglas, null)).toEqual([]);
    expect(reglasDelCuit(reglas, '30111111118')).toEqual([]);
  });

  it('describirCondiciones resume las condiciones extra de una regla en texto', () => {
    const nombres = new Map([['u-gaston', 'Gastón Garnelo']]);
    expect(describirCondiciones(reglas[0], nombres)).toBe('sin condiciones extra');
    expect(describirCondiciones(reglas[2], nombres)).toBe('fuente Foto · usuario Gastón Garnelo');
    expect(describirCondiciones({ ...reglas[0], palabraClave: 'roaming' }, nombres)).toBe('dice «roaming»');
  });
});

describe('nombre por defecto con condiciones extra', () => {
  // Dos reglas del mismo emisor no pueden llamarse igual (unique por empresa):
  // el nombre por defecto incluye las condiciones que la distinguen.
  it('agrega las condiciones extra al nombre para no chocar con la regla amplia', () => {
    const r = construirReglaDesdeAsignacion({ ...base, palabraClave: 'roaming', canal: 'FOTO' });
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla.nombre).toBe('AMX ARGENTINA SA (roaming, Foto) → Telefonía');
  });

  it('sin condiciones extra el nombre queda como siempre', () => {
    const r = construirReglaDesdeAsignacion(base);
    if (!r.crear) throw new Error(r.motivo);
    expect(r.regla.nombre).toBe('AMX ARGENTINA SA → Telefonía');
  });
});

describe('canalRegla (fuente elegida en el atajo)', () => {
  it('acepta sólo fuentes conocidas, sin importar mayúsculas; el resto es "cualquiera"', () => {
    expect(canalRegla('FOTO')).toBe('FOTO');
    expect(canalRegla(' email ')).toBe('EMAIL');
    expect(canalRegla('')).toBeNull();
    expect(canalRegla('FAX')).toBeNull();
    expect(canalRegla(null)).toBeNull();
  });
});
