import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyEmpresaScope, scopedDb } from '@/lib/empresa/scope';
import { rolAlcanza } from '@/lib/roles';
import { ForbiddenError } from '@/lib/errors';
import { prisma } from '@/lib/db';

// Acceptance criterion #1: data from another company can NEVER leak.
// Part 1 — pure unit tests over the args transform.
// Part 2 — integration tests against the real database via the scoped client.

describe('applyEmpresaScope (unitario)', () => {
  it('inyecta empresaId en lecturas', () => {
    const args = applyEmpresaScope('Movimiento', 'findMany', { where: { estado: 'VALIDADO' } }, 'emp1');
    expect(args.where).toEqual({ AND: [{ estado: 'VALIDADO' }, { empresaId: 'emp1' }] });
  });

  it('inyecta empresaId aunque no haya where', () => {
    expect(applyEmpresaScope('Categoria', 'findMany', undefined, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('Categoria', 'count', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
  });

  it('fuerza empresaId al crear, pisando cualquier valor del caller', () => {
    const args = applyEmpresaScope('Movimiento', 'create', { data: { empresaId: 'otra', total: 1 } }, 'emp1');
    expect(args.data.empresaId).toBe('emp1');
    const muchos = applyEmpresaScope('Categoria', 'createMany', { data: [{ nombre: 'x', empresaId: 'otra' }] }, 'emp1');
    expect(muchos.data[0].empresaId).toBe('emp1');
  });

  it('scopea updateMany/deleteMany', () => {
    const args = applyEmpresaScope('Movimiento', 'updateMany', { where: { id: 'm1' }, data: {} }, 'emp1');
    expect(args.where).toEqual({ AND: [{ id: 'm1' }, { empresaId: 'emp1' }] });
  });

  it('scopea modelos hijos por relación (MovimientoLinea)', () => {
    const args = applyEmpresaScope('MovimientoLinea', 'findMany', {}, 'emp1');
    expect(args.where).toEqual({ movimiento: { empresaId: 'emp1' } });
  });

  it('rechaza upsert en modelos scoped', () => {
    expect(() => applyEmpresaScope('Movimiento', 'upsert', {}, 'emp1')).toThrow(ForbiddenError);
  });

  it('no toca modelos sin scope (Usuario, Job)', () => {
    const args = { where: { email: 'a@b.c' } };
    expect(applyEmpresaScope('Usuario', 'findMany', args, 'emp1')).toBe(args);
  });

  it('scopea los modelos de empleados', () => {
    expect(applyEmpresaScope('Empleado', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('ReciboSueldo', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('EmpleadoDistribucionLinea', 'findMany', {}, 'emp1').where).toEqual({
      empleado: { empresaId: 'emp1' },
    });
    expect(applyEmpresaScope('ReciboDistribucionLinea', 'findMany', {}, 'emp1').where).toEqual({
      recibo: { empresaId: 'emp1' },
    });
    expect(applyEmpresaScope('MovimientoEmpleado', 'findMany', {}, 'emp1').where).toEqual({
      movimiento: { empresaId: 'emp1' },
    });
  });

  it('scopea los modelos de resúmenes', () => {
    expect(applyEmpresaScope('Resumen', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('ResumenLinea', 'findMany', {}, 'emp1').where).toEqual({
      resumen: { empresaId: 'emp1' },
    });
  });
});

describe('jerarquía de roles', () => {
  it('CARGADOR < VALIDADOR < ADMINISTRADOR', () => {
    expect(rolAlcanza('CARGADOR', 'CARGADOR')).toBe(true);
    expect(rolAlcanza('CARGADOR', 'VALIDADOR')).toBe(false);
    expect(rolAlcanza('CARGADOR', 'ADMINISTRADOR')).toBe(false);
    expect(rolAlcanza('VALIDADOR', 'CARGADOR')).toBe(true);
    expect(rolAlcanza('VALIDADOR', 'ADMINISTRADOR')).toBe(false);
    expect(rolAlcanza('ADMINISTRADOR', 'VALIDADOR')).toBe(true);
  });
});

describe('scopedDb (integración contra la base)', () => {
  const sufijo = `test-${Date.now()}`;
  let empresaA: string;
  let empresaB: string;
  let usuarioId: string;
  let categoriaB: string;
  let movimientoB: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({
      data: { email: `iso-${sufijo}@test.local`, nombre: 'Test Aislamiento', passwordHash: 'x' },
    });
    usuarioId = usuario.id;
    const a = await prisma.empresa.create({
      data: { slug: `iso-a-${sufijo}`, razonSocial: 'Aislada A', cuit: '30714325651' },
    });
    const b = await prisma.empresa.create({
      data: { slug: `iso-b-${sufijo}`, razonSocial: 'Aislada B', cuit: '20128364847' },
    });
    empresaA = a.id;
    empresaB = b.id;
    const catB = await prisma.categoria.create({
      data: { empresaId: empresaB, nombre: `Secreta B ${sufijo}`, tipo: 'EGRESO' },
    });
    categoriaB = catB.id;
    const movB = await prisma.movimiento.create({
      data: {
        empresaId: empresaB,
        origen: 'ASIENTO_MANUAL',
        estado: 'VALIDADO',
        total: 999,
        creadoPorId: usuarioId,
        descripcion: `dato confidencial B ${sufijo}`,
      },
    });
    movimientoB = movB.id;
  });

  afterAll(async () => {
    await prisma.movimiento.deleteMany({ where: { empresaId: { in: [empresaA, empresaB] } } });
    await prisma.categoria.deleteMany({ where: { empresaId: { in: [empresaA, empresaB] } } });
    await prisma.auditLog.deleteMany({ where: { empresaId: { in: [empresaA, empresaB] } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresaA, empresaB] } } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
    await prisma.$disconnect();
  });

  it('findMany desde A no devuelve datos de B', async () => {
    const dbA = scopedDb(empresaA);
    expect(await dbA.movimiento.findMany({})).toHaveLength(0);
    expect(await dbA.categoria.findMany({ where: { nombre: { contains: sufijo } } })).toHaveLength(0);
  });

  it('findFirst por id exacto de otra empresa devuelve null', async () => {
    const dbA = scopedDb(empresaA);
    expect(await dbA.movimiento.findFirst({ where: { id: movimientoB } })).toBeNull();
    expect(await dbA.categoria.findFirst({ where: { id: categoriaB } })).toBeNull();
  });

  it('findUnique por id de otra empresa devuelve null (guard)', async () => {
    const dbA = scopedDb(empresaA);
    expect(await dbA.movimiento.findUnique({ where: { id: movimientoB } })).toBeNull();
  });

  it('update por id de otra empresa lanza ForbiddenError', async () => {
    const dbA = scopedDb(empresaA);
    await expect(
      dbA.movimiento.update({ where: { id: movimientoB }, data: { descripcion: 'hackeado' } }),
    ).rejects.toThrow(ForbiddenError);
    const intacto = await prisma.movimiento.findUnique({ where: { id: movimientoB } });
    expect(intacto?.descripcion).toContain('dato confidencial B');
  });

  it('delete por id de otra empresa lanza ForbiddenError', async () => {
    const dbA = scopedDb(empresaA);
    await expect(dbA.categoria.delete({ where: { id: categoriaB } })).rejects.toThrow(ForbiddenError);
    expect(await prisma.categoria.findUnique({ where: { id: categoriaB } })).not.toBeNull();
  });

  it('updateMany dirigido a ids de B no afecta nada desde A', async () => {
    const dbA = scopedDb(empresaA);
    const r = await dbA.movimiento.updateMany({ where: { id: movimientoB }, data: { descripcion: 'x' } });
    expect(r.count).toBe(0);
  });

  it('create fuerza la empresa activa aunque el caller intente otra', async () => {
    const dbA = scopedDb(empresaA);
    const creado = await dbA.categoria.create({
      data: { empresaId: empresaB, nombre: `Inyectada ${sufijo}`, tipo: 'EGRESO' } as never,
    });
    expect(creado.empresaId).toBe(empresaA);
  });

  it('las líneas (modelo hijo) tampoco se filtran entre empresas', async () => {
    const cc = await prisma.centroCosto.create({ data: { empresaId: empresaB, nombre: `CC-B ${sufijo}`, tipo: 'NEGOCIO' } });
    await prisma.movimientoLinea.create({
      data: { movimientoId: movimientoB, centroCostoId: cc.id, porcentaje: 100 },
    });
    const dbA = scopedDb(empresaA);
    expect(await dbA.movimientoLinea.findMany({})).toHaveLength(0);
    const dbB = scopedDb(empresaB);
    expect(await dbB.movimientoLinea.findMany({})).toHaveLength(1);
    await prisma.movimientoLinea.deleteMany({ where: { movimientoId: movimientoB } });
    await prisma.centroCosto.delete({ where: { id: cc.id } });
  });

  it('la empresa correcta sí ve sus propios datos', async () => {
    const dbB = scopedDb(empresaB);
    expect(await dbB.movimiento.findMany({})).toHaveLength(1);
    expect(await dbB.categoria.findFirst({ where: { id: categoriaB } })).not.toBeNull();
  });
});
