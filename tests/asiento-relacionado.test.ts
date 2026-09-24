import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { crearAsientoManual } from '@/lib/movimientos/service';

// Un asiento manual puede referenciar un comprobante ya cargado (ajuste,
// complemento, diferencia de cambio). Es sólo trazabilidad: los dos siguen
// computando al P&L. El vínculo tiene que apuntar a un movimiento de la misma
// empresa que no esté anulado ni sea un duplicado.

describe('asiento manual relacionado con un comprobante', () => {
  const sufijo = `rel-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let otraEmpresaId: string;
  let usuarioId: string;
  let categoriaId: string;
  let centroId: string;
  let comprobanteId: string;
  let anuladoId: string;
  let ajenoId: string;
  const creados: string[] = [];

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Rel', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Rel Test', cuit: '30712093486' } });
    const otra = await prisma.empresa.create({ data: { slug: `${sufijo}-b`, razonSocial: 'Rel Otra', cuit: '30718332148' } });
    empresaId = empresa.id;
    otraEmpresaId = otra.id;
    ctx = { empresa, usuario: { id: usuarioId, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Gastos varios', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Admin', tipo: 'SOPORTE' } })).id;
    await prisma.periodo.create({ data: { empresaId, anio: 2026, mes: 8 } });
    const base = { origen: 'COMPROBANTE' as const, fechaDevengamiento: new Date('2026-08-10T00:00:00Z'), total: 1000, creadoPorId: usuarioId, categoriaId };
    comprobanteId = (await prisma.movimiento.create({ data: { ...base, empresaId, estado: 'ASIGNADO' } })).id;
    anuladoId = (await prisma.movimiento.create({ data: { ...base, empresaId, estado: 'ANULADO' } })).id;
    ajenoId = (await prisma.movimiento.create({ data: { ...base, empresaId: otraEmpresaId, estado: 'ASIGNADO', categoriaId: null } })).id;
  });

  afterAll(async () => {
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId: { in: [empresaId, otraEmpresaId] } } } });
    await prisma.movimiento.deleteMany({ where: { empresaId: { in: [empresaId, otraEmpresaId] } } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresaId, otraEmpresaId] } } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  const datos = (relacionadoId: string | null) => ({
    fechaDevengamiento: '2026-08-15',
    categoriaId,
    total: 250,
    descripcion: 'Ajuste',
    lineas: [{ centroCostoId: centroId, clienteId: null, proyectoId: null, porcentaje: 100 }],
    relacionadoId,
  });

  it('guarda el vínculo y se ve desde los dos lados', async () => {
    const id = await crearAsientoManual(ctx, datos(comprobanteId));
    creados.push(id);
    const asiento = await prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { relacionado: true } });
    expect(asiento.relacionadoId).toBe(comprobanteId);
    expect(asiento.relacionado?.id).toBe(comprobanteId);
    const comprobante = await prisma.movimiento.findUniqueOrThrow({ where: { id: comprobanteId }, include: { relacionados: true } });
    expect(comprobante.relacionados.map((r) => r.id)).toContain(id);
    const audit = await prisma.auditLog.findFirst({ where: { empresaId, entidad: 'Movimiento', entidadId: id } });
    expect(JSON.stringify(audit?.despues)).toContain(comprobanteId);
  });

  it('sin vínculo sigue funcionando igual', async () => {
    const id = await crearAsientoManual(ctx, datos(null));
    creados.push(id);
    const asiento = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    expect(asiento.relacionadoId).toBeNull();
  });

  it('rechaza un movimiento de otra empresa', async () => {
    await expect(crearAsientoManual(ctx, datos(ajenoId))).rejects.toThrow(DomainError);
  });

  it('rechaza un movimiento anulado y uno inexistente', async () => {
    await expect(crearAsientoManual(ctx, datos(anuladoId))).rejects.toThrow(DomainError);
    await expect(crearAsientoManual(ctx, datos('no-existe'))).rejects.toThrow(DomainError);
  });
});
