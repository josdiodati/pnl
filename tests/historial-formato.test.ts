import { describe, it, expect } from 'vitest';
import { formatearHistorial, type EventoCrudo, type Referencias } from '@/lib/historial/formato';

const refs: Referencias = {
  usuarios: new Map([['u1', 'José'], ['u2', 'Ana']]),
  contrapartes: new Map([['cp1', 'YPF S.A.']]),
  categorias: new Map([['cat1', 'Combustibles'], ['cat2', 'Peajes']]),
  centros: new Map([['cc1', 'Operaciones']]),
  clientes: new Map([['cli1', 'Acme']]),
  proyectos: new Map([['pr1', 'Obra Norte']]),
};

const base = { id: 'e1', usuarioId: null as string | null, antes: null as unknown, despues: null as unknown, createdAt: new Date('2026-09-01T12:00:00Z') };
const uno = (e: Partial<EventoCrudo> & { accion: string }) => formatearHistorial([{ ...base, ...e }], refs)[0];

describe('formatearHistorial — actor', () => {
  it('usuarioId conocido → nombre', () => {
    expect(uno({ accion: 'VALIDAR', usuarioId: 'u1', antes: {}, despues: {} }).actor).toBe('José');
  });
  it('sin usuarioId → Sistema', () => {
    expect(uno({ accion: 'EXTRAER', despues: {} }).actor).toBe('Sistema');
  });
  it('usuarioId desconocido → rótulo genérico, no el id crudo', () => {
    const a = uno({ accion: 'VALIDAR', usuarioId: 'uX', antes: {}, despues: {} }).actor;
    expect(a).not.toContain('uX');
  });
});

describe('formatearHistorial — ingreso y extracción', () => {
  it('CREAR de comprobante: canal y archivo', () => {
    const f = uno({ accion: 'CREAR', usuarioId: 'u1', despues: { origen: 'COMPROBANTE', canal: 'EMAIL', archivo: 'factura.pdf', hash: 'abc' } });
    expect(f.titulo).toMatch(/ingresado/i);
    expect(f.titulo).toMatch(/EMAIL/);
    expect(f.detalles.join(' ')).toContain('factura.pdf');
  });
  it('CREAR desde resumen: nombra la línea del resumen', () => {
    const f = uno({
      accion: 'CREAR', usuarioId: 'u1',
      despues: { origen: 'RESUMEN', desdeResumen: { descriptor: 'PAGO VISA', resumenId: 'r1' }, total: 1500, categoria: 'Combustibles' },
    });
    expect(f.titulo).toMatch(/resumen/i);
    expect(f.detalles.join(' ')).toContain('PAGO VISA');
  });
  it('EXTRAER: contraparte, campos a revisar y por qué NO se autovalidó', () => {
    const f = uno({
      accion: 'EXTRAER',
      despues: {
        estado: 'PENDIENTE_VALIDACION',
        contraparte: 'YPF S.A.',
        camposRevisar: { total: 'confianza baja', cae: 'no se leyó' },
        duplicados: ['m9'],
        autovalidacion: { apto: false, motivos: ['sin CAE', 'la aritmética no cuadra'], aprobados: ['QR legible'] },
      },
    });
    expect(f.titulo).toMatch(/extra/i);
    const d = f.detalles.join(' | ');
    expect(d).toContain('YPF S.A.');
    expect(d).toMatch(/revisar/i);
    expect(d).toMatch(/no se autovalid/i);
    expect(d).toContain('sin CAE');
    expect(d).toContain('la aritmética no cuadra');
    expect(d).toMatch(/posible duplicado/i);
  });
  it('EXTRAER viejo (sin autovalidacion en el payload) no inventa motivos', () => {
    const f = uno({ accion: 'EXTRAER', despues: { estado: 'PENDIENTE_VALIDACION', camposRevisar: {}, duplicados: [], contraparte: null } });
    expect(f.detalles.join(' ')).not.toMatch(/autovalid/i);
  });
});

describe('formatearHistorial — autovalidación y reglas', () => {
  it('AUTO_VALIDAR: chequeos usados', () => {
    const f = uno({
      accion: 'AUTO_VALIDAR',
      despues: { estado: 'VALIDADO', regla: null, motivos: [], chequeos: ['QR legible', 'CAE presente', 'la aritmética cuadra'] },
    });
    expect(f.titulo).toMatch(/autovalidado/i);
    expect(f.detalles.join(' ')).toContain('QR legible');
    expect(f.detalles.join(' ')).toContain('la aritmética cuadra');
  });
  it('AUTO_ASIGNAR con regla enriquecida: nombre, condiciones y categoría', () => {
    const f = uno({
      accion: 'AUTO_ASIGNAR',
      despues: {
        estado: 'ASIGNADO',
        chequeos: ['QR legible'],
        regla: {
          nombre: 'YPF combustible',
          condiciones: [{ tipo: 'CUIT', valor: '30-71111111-8' }, { tipo: 'PALABRA_CLAVE', valor: 'nafta' }],
          categoriaId: 'cat1',
        },
      },
    });
    expect(f.titulo).toMatch(/asignado/i);
    const d = f.detalles.join(' | ');
    expect(d).toContain('YPF combustible');
    expect(d).toContain('30-71111111-8');
    expect(d).toContain('«nafta»');
    expect(d).toContain('Combustibles');
  });
  it('AUTO_ASIGNAR viejo (regla como string) sigue mostrando el nombre', () => {
    const f = uno({ accion: 'AUTO_ASIGNAR', despues: { estado: 'ASIGNADO', regla: 'Sircreb', motivos: [] } });
    expect(f.detalles.join(' ')).toContain('Sircreb');
  });
  it('AUTO_OBSERVAR por regla', () => {
    const f = uno({ accion: 'AUTO_OBSERVAR', despues: { estado: 'OBSERVADO', regla: 'Descartes banco' } });
    expect(f.titulo).toMatch(/observado/i);
    expect(f.detalles.join(' ')).toContain('Descartes banco');
  });
  it('AUTO_OBSERVAR por ARCA inválido', () => {
    const f = uno({
      accion: 'AUTO_OBSERVAR',
      antes: { estado: 'VALIDADO' },
      despues: { estado: 'OBSERVADO', motivo: 'ARCA INVALIDO post-validación', detalle: 'CAE inexistente' },
    });
    expect(f.detalles.join(' ')).toContain('CAE inexistente');
  });
});

describe('formatearHistorial — duplicados y ARCA', () => {
  it.each([
    ['HASH_ARCHIVO', /mismo archivo/i],
    ['QR', /QR/],
    ['ARCA', /ARCA/],
  ])('AUTO_DUPLICADO confirmado por %s', (confirmadoPor, re) => {
    const f = uno({ accion: 'AUTO_DUPLICADO', despues: { estado: 'DUPLICADO', duplicados: ['m1'], confirmadoPor } });
    expect(f.titulo).toMatch(/duplicado/i);
    expect(f.detalles.join(' ')).toMatch(re);
  });
  it('ARCA_CONSTATAR', () => {
    const f = uno({ accion: 'ARCA_CONSTATAR', despues: { estado: 'VALIDO', detalle: null } });
    expect(f.titulo).toMatch(/ARCA/);
    expect(f.titulo).toMatch(/VALIDO|válido/i);
  });
});

describe('formatearHistorial — validación manual (diff)', () => {
  const antes = {
    estado: 'PENDIENTE_VALIDACION', total: '1200', categoriaId: null, contraparteId: 'cp1',
    descripcion: 'nafta super', moneda: 'ARS', numero: '00001234',
  };
  it('VALIDAR: muestra qué campos cambió el usuario, con nombres resueltos', () => {
    const f = uno({
      accion: 'VALIDAR', usuarioId: 'u2', antes,
      despues: { ...antes, estado: 'VALIDADO', total: '1250', categoriaId: 'cat2', validadoPorId: 'u2' },
    });
    expect(f.actor).toBe('Ana');
    expect(f.titulo).toMatch(/validado/i);
    const d = f.detalles.join(' | ');
    expect(d).toMatch(/total/i);
    expect(d).toContain('1.200');
    expect(d).toContain('1.250');
    expect(d).toMatch(/categoría/i);
    expect(d).toContain('Peajes');
    expect(d).not.toContain('cat2'); // ids resueltos a nombres
  });
  it('VALIDAR sin cambios de datos: lo dice en vez de listar ruido', () => {
    const f = uno({ accion: 'VALIDAR', usuarioId: 'u2', antes, despues: { ...antes, estado: 'VALIDADO', validadoPorId: 'u2' } });
    expect(f.detalles.join(' ')).toMatch(/sin cambios/i);
  });
  it('VALIDAR que termina ASIGNADO lo dice en el título', () => {
    const f = uno({ accion: 'VALIDAR', usuarioId: 'u2', antes, despues: { ...antes, estado: 'ASIGNADO' } });
    expect(f.titulo).toMatch(/asignado/i);
  });
  it('VALIDAR con overrides los muestra', () => {
    const f = uno({
      accion: 'VALIDAR', usuarioId: 'u2', antes,
      despues: { ...antes, estado: 'VALIDADO', overrideNoFiscal: true, overrideNoFiscalMotivo: 'ticket exterior' },
    });
    expect(f.detalles.join(' ')).toContain('ticket exterior');
  });
  it('VALIDAR con líneas de imputación las resume', () => {
    const f = uno({
      accion: 'VALIDAR', usuarioId: 'u2', antes,
      despues: { ...antes, estado: 'ASIGNADO', lineas: [{ centroCostoId: 'cc1', clienteId: 'cli1', proyectoId: null, porcentaje: 100 }] },
    });
    const d = f.detalles.join(' ');
    expect(d).toContain('Operaciones');
    expect(d).toContain('Acme');
    expect(d).toContain('100%');
  });
});

describe('formatearHistorial — asignación y estados', () => {
  it('ASIGNAR: categoría y distribución', () => {
    const f = uno({
      accion: 'ASIGNAR', usuarioId: 'u1',
      antes: { estado: 'VALIDADO', categoriaId: null },
      despues: { estado: 'ASIGNADO', categoriaId: 'cat1', lineas: [{ centroCostoId: 'cc1', clienteId: null, proyectoId: null, porcentaje: 100 }] },
    });
    expect(f.titulo).toMatch(/asignado/i);
    const d = f.detalles.join(' ');
    expect(d).toContain('Combustibles');
    expect(d).toContain('Operaciones');
  });
  it('OBSERVAR con nota', () => {
    const f = uno({ accion: 'OBSERVAR', usuarioId: 'u1', antes: { estado: 'PENDIENTE_VALIDACION' }, despues: { estado: 'OBSERVADO', nota: 'falta el CAE' } });
    expect(f.detalles.join(' ')).toContain('falta el CAE');
  });
  it('ANULAR con motivo', () => {
    const f = uno({ accion: 'ANULAR', usuarioId: 'u1', antes: { estado: 'VALIDADO' }, despues: { estado: 'ANULADO', motivo: 'cargado dos veces' } });
    expect(f.titulo).toMatch(/anulado/i);
    expect(f.detalles.join(' ')).toContain('cargado dos veces');
  });
  it('VOLVER_A_PENDIENTE con reprocesamiento', () => {
    const f = uno({ accion: 'VOLVER_A_PENDIENTE', usuarioId: 'u1', antes: { estado: 'DUPLICADO' }, despues: { estado: 'INGRESADO', nota: null, reprocesa: true } });
    expect(f.detalles.join(' ')).toMatch(/re-?proces/i);
  });
  it('acción desconocida no rompe: muestra la acción cruda', () => {
    const f = uno({ accion: 'ALGO_RARO', despues: { x: 1 } });
    expect(f.titulo).toContain('ALGO_RARO');
  });
});
