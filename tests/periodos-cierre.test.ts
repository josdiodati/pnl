import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { estadoCierre, claveMes } from '@/lib/periodos/cierre';

// Estado de cierre por mes: comprobantes (bloquean), resúmenes, ARCA y
// sueldos (informativos).

describe('estadoCierre (integración contra la base)', () => {
  const sufijo = `cierre-${Date.now()}`;
  let empresaId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'T', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Cierre SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    const sep = (await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 9 } })).id;
    await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 10 } });
    const mov = (estado: string, dia: number) =>
      prisma.movimiento.create({
        data: {
          empresaId, periodoId: sep, estado, origen: 'COMPROBANTE', moneda: 'ARS', total: 100, creadoPorId: usuario.id,
          fechaDevengamiento: new Date(Date.UTC(2031, 8, dia)),
        } as never,
      });
    await mov('PENDIENTE_VALIDACION', 3);
    await mov('OBSERVADO', 4);
    await mov('VALIDADO', 5);
    await mov('ASIGNADO', 6);
    await mov('ERROR_PROCESAMIENTO', 7);
    const resumen = await prisma.resumen.create({
      data: { empresaId, tipo: 'TARJETA', emisor: 'VISA TEST', periodoId: sep, estado: 'EXTRAIDO', archivoKey: 'x', archivoNombre: 'x.pdf', archivoMime: 'application/pdf', archivoHash: `h-${Date.now()}` } as never,
    });
    await prisma.resumenLinea.createMany({
      data: [
        { resumenId: resumen.id, orden: 1, descriptor: 'a', monto: -10, estado: 'PENDIENTE' },
        { resumenId: resumen.id, orden: 2, descriptor: 'b', monto: -10, estado: 'SUGERIDA' },
        { resumenId: resumen.id, orden: 3, descriptor: 'c', monto: -10, estado: 'CONCILIADA' },
      ] as never,
    });
    const e1 = await prisma.empleado.create({ data: { empresaId, nombre: 'UNO', cuil: '27312518045' } });
    await prisma.empleado.create({ data: { empresaId, nombre: 'DOS', cuil: '20347308618' } });
    await prisma.empleado.create({ data: { empresaId, nombre: 'EGRESADO', cuil: '20393406292', fechaEgreso: new Date(Date.UTC(2031, 7, 31)) } });
    await prisma.reciboSueldo.create({ data: { empresaId, empleadoId: e1.id, periodoId: sep, estado: 'PENDIENTE_REVISION' } });
  });

  afterAll(async () => {
    await prisma.reciboSueldo.deleteMany({ where: { empresaId } });
    await prisma.empleado.deleteMany({ where: { empresaId } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('cuenta lo que bloquea y lo que es informativo, por mes', async () => {
    const r = await estadoCierre(scopedDb(empresaId), empresaId, [{ anio: 2031, mes: 9 }, { anio: 2031, mes: 10 }]);
    const sep = r.get(claveMes(2031, 9))!;
    expect(sep.comprobantes).toEqual({ porValidar: 1, observados: 1, porAsignar: 1, retenidos: 0, conError: 1 });
    expect(sep.bloqueantes).toBe(3);
    expect(sep.resumenes).toEqual([expect.objectContaining({ emisor: 'VISA TEST', lineas: 3, sinConciliar: 2 })]);
    expect(sep.arca.conectado).toBe(false);
    // DOS no tiene recibo; el egresado en agosto no cuenta en septiembre.
    expect(sep.sueldos).toEqual({ hayEmpleados: true, pendientes: 1, sinRecibo: 1 });
    expect(sep.advertencias).toBe(1 + 2 + 1 + 1); // error + líneas + recibo pendiente + sin recibo

    const oct = r.get(claveMes(2031, 10))!;
    expect(oct.bloqueantes).toBe(0);
    expect(oct.advertencias).toBe(0); // mes sin recibos cargados: "sin recibo" no aplica
  });
});
