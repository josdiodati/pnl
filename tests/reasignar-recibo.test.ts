import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { reasignarRecibo } from '@/lib/empleados/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Reasignar un recibo CONFIRMADO: corrige la distribución de meses ya hechos
// sin anular nada. Sólo con período abierto; queda auditado.

describe('reasignarRecibo (integración contra la base)', () => {
  const sufijo = `reasig-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let adm: string;
  let bpo: string;
  let reciboId: string;
  let reciboPendienteId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({
      data: { email: `${sufijo}@test.local`, nombre: 'Test Reasignar', passwordHash: 'x' },
    });
    const empresa = await prisma.empresa.create({
      data: { slug: sufijo, razonSocial: 'Reasignar SA', cuit: '30714325651' },
    });
    empresaId = empresa.id;
    adm = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Adm', tipo: 'SOPORTE' } })).id;
    bpo = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } })).id;
    const empleado = await prisma.empleado.create({ data: { empresaId, nombre: 'GODOY TEST', cuil: '27312518045' } });
    const periodo = await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 3 } });
    const recibo = await prisma.reciboSueldo.create({
      data: {
        empresaId, empleadoId: empleado.id, periodoId: periodo.id, tipo: 'MENSUAL', estado: 'CONFIRMADO',
        costoTotalEmpleador: 1000,
        lineas: { create: [{ centroCostoId: bpo, porcentaje: 60 }, { centroCostoId: adm, porcentaje: 40 }] },
      },
    });
    reciboId = recibo.id;
    reciboPendienteId = (await prisma.reciboSueldo.create({
      data: { empresaId, empleadoId: empleado.id, periodoId: periodo.id, tipo: 'SAC', estado: 'PENDIENTE_REVISION' },
    })).id;
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

  it('reemplaza la distribución de un recibo confirmado', async () => {
    await reasignarRecibo(ctx, reciboId, [{ centroCostoId: adm, porcentaje: 100 }]);
    const lineas = await prisma.reciboDistribucionLinea.findMany({ where: { reciboId } });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].centroCostoId).toBe(adm);
    expect(Number(lineas[0].porcentaje)).toBe(100);
  });

  it('rechaza reasignar un recibo no confirmado', async () => {
    await expect(reasignarRecibo(ctx, reciboPendienteId, [{ centroCostoId: adm, porcentaje: 100 }])).rejects.toThrow(DomainError);
  });

  it('rechaza con período cerrado', async () => {
    await prisma.periodo.updateMany({ where: { empresaId }, data: { estado: 'CERRADO' } });
    await expect(reasignarRecibo(ctx, reciboId, [{ centroCostoId: bpo, porcentaje: 100 }])).rejects.toThrow(/cerrado/);
    await prisma.periodo.updateMany({ where: { empresaId }, data: { estado: 'ABIERTO' } });
  });
});
