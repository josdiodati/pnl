import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { distribucionVigente, actualizarFichaSiEsUltimo } from '@/lib/empleados/asignacion';
import { confirmarRecibo, reasignarRecibo } from '@/lib/empleados/service';

// Asignación permanente: la ficha rige mes a mes; si está vacía se toma la del
// último recibo confirmado, y confirmar/reasignar el recibo más reciente la
// actualiza.

describe('asignación permanente del empleado (integración contra la base)', () => {
  const sufijo = `asigperm-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let adm: string;
  let bpo: string;
  let empleadoId: string;
  let sep: string;

  const ficha = async () =>
    (await prisma.empleadoDistribucionLinea.findMany({ where: { empleadoId } }))
      .map((l) => `${l.centroCostoId === adm ? 'adm' : 'bpo'}:${Number(l.porcentaje)}`)
      .sort();

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Asig SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    adm = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Adm', tipo: 'SOPORTE' } })).id;
    bpo = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } })).id;
    empleadoId = (await prisma.empleado.create({ data: { empresaId, nombre: 'EMP TEST', cuil: '27312518045' } })).id;
    const jul = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 7 } })).id;
    const ago = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 8 } })).id;
    sep = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 9 } })).id;
    await prisma.reciboSueldo.create({
      data: {
        empresaId, empleadoId, periodoId: jul, estado: 'CONFIRMADO', costoTotalEmpleador: 1000,
        lineas: { create: [{ centroCostoId: adm, porcentaje: 100 }] },
      },
    });
    await prisma.reciboSueldo.create({
      data: {
        empresaId, empleadoId, periodoId: ago, estado: 'CONFIRMADO', costoTotalEmpleador: 1000,
        lineas: { create: [{ centroCostoId: bpo, porcentaje: 60 }, { centroCostoId: adm, porcentaje: 40 }] },
      },
    });
    ctx = {
      empresa,
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      rol: 'ADMINISTRADOR',
      db: scopedDb(empresaId),
    } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.reciboSueldo.deleteMany({ where: { empresaId } });
    await prisma.empleado.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('con la ficha vacía toma el último recibo confirmado y lo guarda en la ficha', async () => {
    const { lineas, origen } = await distribucionVigente(empleadoId);
    expect(origen).toBe('recibo');
    expect(lineas).toHaveLength(2);
    expect(await ficha()).toEqual(['adm:40', 'bpo:60']);
    expect((await distribucionVigente(empleadoId)).origen).toBe('ficha');
  });

  it('corregir un mes viejo no toca la ficha', async () => {
    expect(await actualizarFichaSiEsUltimo(empleadoId, { anio: 2031, mes: 7 }, [{ centroCostoId: bpo, porcentaje: 100 }])).toBe(false);
    expect(await ficha()).toEqual(['adm:40', 'bpo:60']);
  });

  it('confirmar/reasignar el recibo más reciente con otra distribución actualiza la ficha', async () => {
    const pendiente = await prisma.reciboSueldo.create({
      data: { empresaId, empleadoId, periodoId: sep, estado: 'PENDIENTE_REVISION', costoTotalEmpleador: 1000 },
    });
    await confirmarRecibo(ctx, pendiente.id, { lineas: [{ centroCostoId: bpo, porcentaje: 100 }] });
    expect(await ficha()).toEqual(['bpo:100']);

    await reasignarRecibo(ctx, pendiente.id, [{ centroCostoId: adm, porcentaje: 100 }]);
    expect(await ficha()).toEqual(['adm:100']);
  });

  it('confirmar sin líneas usa la ficha vigente', async () => {
    const oct = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 10 } })).id;
    const pendiente = await prisma.reciboSueldo.create({
      data: { empresaId, empleadoId, periodoId: oct, estado: 'PENDIENTE_REVISION', costoTotalEmpleador: 1000 },
    });
    await confirmarRecibo(ctx, pendiente.id, {});
    const lineas = await prisma.reciboDistribucionLinea.findMany({ where: { reciboId: pendiente.id } });
    expect(lineas.map((l) => [l.centroCostoId, Number(l.porcentaje)])).toEqual([[adm, 100]]);
  });
});
