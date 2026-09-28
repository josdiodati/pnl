import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { registrarCobro, editarCobro, acreditarCheque, rechazarCheque } from '@/lib/cobranzas/service';
import { mapaCobranza } from '@/lib/cobranzas/query';

// Edición de un cobro: datos descriptivos en el lugar; importes/fechas
// recalculan el reparto (sin contar el propio cobro) conservando grupo, autor
// y cheques acreditados. Todo en el historial del cobro y de cada venta.

describe('cobranzas: editar cobro (integración)', () => {
  const sufijo = `cobed-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let usuarioId: string;
  let categoriaVentaId: string;
  let centroId: string;
  let clienteId: string;
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  const venta = async (total: number, fecha: string, over: Record<string, unknown> = {}) => {
    const f = d(fecha);
    const periodo = await prisma.periodo.findFirst({ where: { empresaId, anio: f.getUTCFullYear(), mes: f.getUTCMonth() + 1 } })
      ?? await prisma.periodo.create({ data: { empresaId, anio: f.getUTCFullYear(), mes: f.getUTCMonth() + 1 } });
    const m = await prisma.movimiento.create({
      data: {
        empresaId, origen: 'VENTA_COMPROBANTE', estado: 'ASIGNADO', total, creadoPorId: usuarioId,
        fechaDevengamiento: f, periodoId: periodo.id, categoriaId: categoriaVentaId, contraparteId: clienteId,
        tipoComprobante: 'FACTURA_A', puntoVenta: '00002', numero: `${Math.floor(Math.random() * 1e6)}`,
        lineas: { create: [{ centroCostoId: centroId, porcentaje: 100 }] },
        ...(over as object),
      } as never,
    });
    return m.id;
  };
  const info = async (id: string) => (await mapaCobranza(ctx.db, d('2026-09-01'))).get(id)!;
  const tr = (monto: number, fecha = '2026-08-05', over: Record<string, unknown> = {}) => ({
    instrumento: 'TRANSFERENCIA', monto, moneda: 'ARS', fecha: d(fecha), fechaAcreditacion: d(fecha), ...over,
  });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Cob', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Cob SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    categoriaVentaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Ventas Cob', tipo: 'INGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Centro Cob', tipo: 'NEGOCIO' } })).id;
    clienteId = (await prisma.contraparte.create({ data: { empresaId, cuit: '30661571663', razonSocial: 'COMNET S A', tipo: 'CLIENTE' } })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.cobro.deleteMany({ where: { empresaId } });
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.contraparte.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  const cobrosDe = (grupo: string) => prisma.cobro.findMany({ where: { grupo }, include: { aplicaciones: true }, orderBy: { monto: 'asc' } });
  const conId = (c: { id: string; instrumento: string; monto: unknown; moneda: string; fecha: Date; fechaAcreditacion: Date; numero: string | null; banco: string | null }, over: Record<string, unknown> = {}) => ({
    cobroId: c.id, instrumento: c.instrumento, monto: Number(c.monto), moneda: c.moneda, fecha: c.fecha, fechaAcreditacion: c.fechaAcreditacion, numero: c.numero, banco: c.banco, ...over,
  });

  it('cambiar sólo banco, número y nota actualiza en el lugar y queda en el historial', async () => {
    const a = await venta(1000, '2026-07-01');
    const grupo = await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(1000)] });
    const [c] = await cobrosDe(grupo);
    await editarCobro(ctx, grupo, { instrumentos: [conId(c, { banco: 'Galicia', numero: 'OP 123' })], nota: 'recibo 44' });
    const [e] = await cobrosDe(grupo);
    expect(e.id).toBe(c.id); // mismo registro
    expect([e.banco, e.numero, e.nota]).toEqual(['Galicia', 'OP 123', 'recibo 44']);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entidad: 'Cobro', entidadId: grupo, accion: 'COBRO_EDITAR' } });
    expect((log.antes as any).instrumentos[0].banco).toBeNull();
    expect((log.despues as any).instrumentos[0].banco).toBe('Galicia');
    // Sin cambios: no escribe nada.
    await editarCobro(ctx, grupo, { instrumentos: [conId(e)], nota: 'recibo 44' });
    expect(await prisma.auditLog.count({ where: { entidad: 'Cobro', entidadId: grupo, accion: 'COBRO_EDITAR' } })).toBe(1);
  });

  it('cambiar el monto recalcula el saldo, conserva grupo y autor, y el saldo propio no cuenta', async () => {
    const a = await venta(1000, '2026-07-02');
    const grupo = await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(1000)] });
    const [c] = await cobrosDe(grupo);
    expect((await info(a)).estado).toBe('COBRADA');
    const otro = { ...ctx, usuario: { ...ctx.usuario, id: ctx.usuario.id } };
    await editarCobro(otro, grupo, { instrumentos: [conId(c, { monto: 600 })] });
    const ia = await info(a);
    expect(ia.estado).toBe('PARCIAL');
    expect(ia.saldo).toBe(400);
    const [e] = await cobrosDe(grupo);
    expect(Number(e.monto)).toBe(600);
    expect(e.creadoPorId).toBe(c.creadoPorId);
    expect(e.createdAt).toEqual(c.createdAt);
    expect(await prisma.auditLog.count({ where: { entidad: 'Movimiento', entidadId: a, accion: 'COBRO_EDITAR' } })).toBe(1);
    await expect(editarCobro(ctx, grupo, { instrumentos: [conId(e, { monto: 1200 })] })).rejects.toThrow(/supera el saldo/);
    // agregar una retención por el resto
    await editarCobro(ctx, grupo, { instrumentos: [conId(e), { instrumento: 'RETENCION', monto: 400, moneda: 'ARS', fecha: e.fecha, fechaAcreditacion: e.fecha }] });
    expect((await info(a)).estado).toBe('COBRADA');
    expect(await prisma.cobro.count({ where: { grupo } })).toBe(2);
  });

  it('un cheque acreditado sigue acreditado al editar el otro instrumento', async () => {
    const a = await venta(1000, '2026-08-01');
    const grupo = await registrarCobro(ctx, {
      ventaIds: [a],
      instrumentos: [
        tr(400, '2026-08-10', { instrumento: 'CHEQUE', numero: '111', fechaAcreditacion: d('2026-09-15') }),
        tr(500, '2026-08-10', { instrumento: 'CHEQUE', numero: '222', fechaAcreditacion: d('2026-10-15') }),
      ],
    });
    const [c1, c2] = await cobrosDe(grupo);
    await acreditarCheque(ctx, c1.id);
    await editarCobro(ctx, grupo, { instrumentos: [conId({ ...c1, estado: 'x' } as any), conId(c2, { monto: 600 })] });
    const [e1, e2] = await cobrosDe(grupo);
    expect([e1.numero, e1.estado]).toEqual(['111', 'ACREDITADO']);
    expect([e2.numero, e2.estado, Number(e2.monto)]).toEqual(['222', 'EN_CARTERA', 600]);
  });

  it('confirmado por el resumen o con un cheque rechazado: sólo n°, banco y nota', async () => {
    const a = await venta(1000, '2026-08-02');
    const grupo = await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(1000, '2026-08-10', { instrumento: 'CHEQUE', numero: '9' })] });
    const [c] = await cobrosDe(grupo);
    await rechazarCheque(ctx, c.id, 'sin fondos');
    await expect(editarCobro(ctx, grupo, { instrumentos: [conId(c, { monto: 900 })] })).rejects.toThrow(/cheque rechazado/);

    const b = await venta(500, '2026-08-03');
    const g2 = await registrarCobro(ctx, { ventaIds: [b], instrumentos: [tr(500)] });
    await prisma.cobro.updateMany({ where: { grupo: g2 }, data: { origen: 'RESUMEN' } });
    const [c2] = await cobrosDe(g2);
    await expect(editarCobro(ctx, g2, { instrumentos: [conId(c2, { fecha: d('2026-08-06') })] })).rejects.toThrow(/resumen/);
    await editarCobro(ctx, g2, { instrumentos: [conId(c2, { banco: 'Nación' })] });
    expect((await cobrosDe(g2))[0].banco).toBe('Nación');
  });

  it('factura en USD: cambiar la cotización rehace el ajuste de cambio y anula el viejo', async () => {
    const e = await venta(100, '2026-08-19', { moneda: 'USD', tipoCambio: 1500, tipoComprobante: 'FACTURA_E' });
    const grupo = await registrarCobro(ctx, { ventaIds: [e], instrumentos: [tr(148000, '2026-08-20')] });
    const [c] = await cobrosDe(grupo);
    const ajusteViejo = c.aplicaciones[0].ajusteId!;
    await editarCobro(ctx, grupo, { instrumentos: [conId(c, { monto: 152000 })], cotizacion: 1520 });
    const [n] = await cobrosDe(grupo);
    expect(Number(n.tipoCambio)).toBe(1520);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: ajusteViejo } })).estado).toBe('ANULADO');
    const nuevo = await prisma.movimiento.findUniqueOrThrow({ where: { id: n.aplicaciones[0].ajusteId! } });
    expect(Number(nuevo.total)).toBe(2000);
    expect((await info(e)).estado).toBe('COBRADA');
  });
});
