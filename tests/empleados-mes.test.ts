import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { costosDelMes, correspondeAlMes, totalEmpleadoMes, ultimoPeriodoConRecibos } from '@/lib/empleados/mes';

// Costo del mes por empleado (pestaña Empleados y Detalle mensual) y último
// período con recibos (el que muestra la pestaña Empleados).

describe('correspondeAlMes', () => {
  const egreso = (iso: string) => ({ fechaEgreso: new Date(`${iso}T00:00:00Z`) });
  it('sin egreso corresponde siempre; con egreso, hasta el mes de egreso inclusive', () => {
    expect(correspondeAlMes({ fechaEgreso: null }, 2031, 9)).toBe(true);
    expect(correspondeAlMes(egreso('2031-09-30'), 2031, 9)).toBe(true);
    expect(correspondeAlMes(egreso('2031-09-01'), 2031, 9)).toBe(true);
    expect(correspondeAlMes(egreso('2031-09-15'), 2031, 10)).toBe(false);
    expect(correspondeAlMes(egreso('2031-12-31'), 2032, 1)).toBe(false);
    expect(correspondeAlMes(egreso('2032-01-10'), 2031, 12)).toBe(true);
  });
});

describe('costos del mes por empleado (integración contra la base)', () => {
  const sufijo = `empmes-${Date.now()}`;
  let empresaId: string;
  let adm: string;
  let bpo: string;
  let e1: string;
  let e2: string;

  beforeAll(async () => {
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'EmpMes SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    adm = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Adm', tipo: 'SOPORTE' } })).id;
    bpo = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } })).id;
    e1 = (await prisma.empleado.create({ data: { empresaId, nombre: 'UNO', cuil: '27312518045' } })).id;
    e2 = (await prisma.empleado.create({ data: { empresaId, nombre: 'DOS', cuil: '20347308618' } })).id;
    const ago = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 8 } })).id;
    const sep = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 9 } })).id;
    await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 10 } }); // sin recibos
    await prisma.reciboSueldo.create({
      data: {
        empresaId, empleadoId: e1, periodoId: ago, estado: 'CONFIRMADO', costoTotalEmpleador: 500,
        lineas: { create: [{ centroCostoId: adm, porcentaje: 100 }] },
      },
    });
    await prisma.reciboSueldo.create({
      data: {
        empresaId, empleadoId: e1, periodoId: sep, estado: 'CONFIRMADO', costoTotalEmpleador: 1000,
        lineas: { create: [{ centroCostoId: bpo, porcentaje: 60 }, { centroCostoId: adm, porcentaje: 40 }] },
      },
    });
    await prisma.reciboSueldo.create({
      data: { empresaId, empleadoId: e2, periodoId: sep, estado: 'PENDIENTE_REVISION', costoTotalEmpleador: 800 },
    });
    await prisma.reciboSueldo.create({
      data: { empresaId, empleadoId: e2, periodoId: sep, tipo: 'SAC', estado: 'ANULADO', costoTotalEmpleador: 999 },
    });
  });

  afterAll(async () => {
    await prisma.reciboSueldo.deleteMany({ where: { empresaId } });
    await prisma.empleado.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
  });

  it('último período con recibos ignora los meses vacíos', async () => {
    expect(await ultimoPeriodoConRecibos(scopedDb(empresaId))).toEqual({ anio: 2031, mes: 9 });
  });

  it('suma confirmados, marca pendientes y descarta anulados', async () => {
    const c = await costosDelMes(scopedDb(empresaId), 2031, 9);
    expect(totalEmpleadoMes(c.get(e1))).toBe(1000);
    expect(c.get(e1)?.pendiente).toBe(false);
    expect(c.get(e2)).toMatchObject({ recibos: 0, pendiente: true, tieneRecibo: true });
  });

  it('con centro filtrado toma la porción', async () => {
    const c = await costosDelMes(scopedDb(empresaId), 2031, 9, bpo);
    expect(c.get(e1)?.recibos).toBe(600);
  });
});
