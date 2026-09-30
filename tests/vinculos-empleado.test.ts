import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { montoVinculableDe, esCategoriaAdicionalesSalario, vincularPorRegla } from '@/lib/empleados/vinculos';
import { guardarReglaDesdeAsignacion } from '@/lib/reglas/guardar-desde-asignacion';

// Vínculos comprobante → empleado: monto por defecto (neto gravado), la
// categoría que habilita elegir empleado, el vínculo automático por regla y la
// regla que recuerda el empleado.

describe('montoVinculableDe', () => {
  it('es el neto: total menos IVA, percepciones y otros tributos', () => {
    expect(montoVinculableDe({ total: 1210, iva21: 210 })).toBe(1000);
    expect(montoVinculableDe({ total: 1300, iva21: 210, percepcionesIibb: 30, otrosTributos: 60 })).toBe(1000);
    expect(montoVinculableDe({ total: 800 })).toBe(800); // sin desglose (factura C): el total
    expect(montoVinculableDe({})).toBeNull();
  });
});

describe('esCategoriaAdicionalesSalario', () => {
  it('reconoce las variantes del nombre', () => {
    expect(esCategoriaAdicionalesSalario('Adicionales Salarios')).toBe(true);
    expect(esCategoriaAdicionalesSalario('Adicionales de Salario')).toBe(true);
    expect(esCategoriaAdicionalesSalario('adicional salario')).toBe(true);
    expect(esCategoriaAdicionalesSalario('Adicionales de Salário')).toBe(true);
    expect(esCategoriaAdicionalesSalario('Sueldos')).toBe(false);
    expect(esCategoriaAdicionalesSalario(null)).toBe(false);
  });
});

describe('vínculo por regla y regla con empleado (integración contra la base)', () => {
  const sufijo = `vincemp-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let empleadoId: string;
  let categoriaId: string;
  let centroId: string;
  let periodoId: string;

  const movimiento = (datos: { netoGravado?: number; iva21?: number; total: number }) =>
    prisma.movimiento.create({
      data: {
        empresaId, periodoId, estado: 'ASIGNADO', origen: 'COMPROBANTE', moneda: 'ARS', creadoPorId: ctx.usuario.id,
        categoriaId, netoGravado: datos.netoGravado, iva21: datos.iva21, total: datos.total,
      } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Vinc SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    empleadoId = (await prisma.empleado.create({ data: { empresaId, nombre: 'EMP VINC', cuil: '27312518045' } })).id;
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Adicionales Salarios', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Adm', tipo: 'SOPORTE' } })).id;
    periodoId = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 9 } })).id;
    ctx = {
      empresa,
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      rol: 'ADMINISTRADOR',
      db: scopedDb(empresaId),
    } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.movimientoEmpleado.deleteMany({ where: { empleado: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.reglaAsignacion.deleteMany({ where: { empresaId } });
    await prisma.plantillaDistribucion.deleteMany({ where: { empresaId } });
    await prisma.empleado.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('vincula por el neto gravado y no duplica', async () => {
    const mov = await movimiento({ netoGravado: 1000, iva21: 210, total: 1210 });
    expect(await vincularPorRegla(ctx.db, { movimientoId: mov.id, empleadoId, regla: 'r' })).toBe(true);
    expect(await vincularPorRegla(ctx.db, { movimientoId: mov.id, empleadoId, regla: 'r' })).toBe(false);
    const v = await prisma.movimientoEmpleado.findMany({ where: { movimientoId: mov.id } });
    expect(v.map((x) => Number(x.monto))).toEqual([1000]);
  });

  it('nunca supera lo que queda del total', async () => {
    const mov = await movimiento({ netoGravado: 1000, iva21: 210, total: 1210 });
    const otro = (await prisma.empleado.create({ data: { empresaId, nombre: 'OTRO', cuil: '20347308618' } })).id;
    await prisma.movimientoEmpleado.create({ data: { movimientoId: mov.id, empleadoId: otro, monto: 900 } });
    expect(await vincularPorRegla(ctx.db, { movimientoId: mov.id, empleadoId, regla: 'r' })).toBe(true);
    const mio = await prisma.movimientoEmpleado.findFirst({ where: { movimientoId: mov.id, empleadoId } });
    expect(Number(mio!.monto)).toBe(310);
  });

  it('la regla guardada desde la asignación recuerda el empleado', async () => {
    const r = await guardarReglaDesdeAsignacion(ctx, {
      cuit: '30500010912',
      razonSocial: 'PROVEEDOR BONOS',
      categoriaId,
      lineas: [{ centroCostoId: centroId, porcentaje: 100 }],
      palabraClave: null,
      nombre: null,
      empleadoId,
    });
    expect(r.ok).toBe(true);
    expect(r.mensaje).toContain('EMP VINC');
    const regla = await prisma.reglaAsignacion.findFirst({ where: { empresaId } });
    expect(regla?.empleadoId).toBe(empleadoId);
  });
});
