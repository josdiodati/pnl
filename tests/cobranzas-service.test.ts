import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import {
  registrarCobro,
  eliminarCobroGrupo,
  cerrarSaldoComoRetencion,
  acreditarCheque,
  rechazarCheque,
  fijarFechaProbable,
  fijarPlazoCliente,
  CATEGORIA_DIFERENCIA_CAMBIO,
} from '@/lib/cobranzas/service';
import { mapaCobranza } from '@/lib/cobranzas/query';
import { anularMovimiento } from '@/lib/movimientos/service';

// Registro de cobros (Spec F, etapa 2) contra la base: N:N con importes,
// cheques en cartera, retención de un clic, ajuste por diferencia de cambio y
// su anulación al deshacer.

describe('cobranzas: servicio (integración)', () => {
  const sufijo = `cob-${Date.now()}`;
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

  it('una transferencia paga dos facturas (FIFO) y cada una queda con su saldo', async () => {
    const a = await venta(300, '2026-07-01');
    const b = await venta(500, '2026-07-10');
    const grupo = await registrarCobro(ctx, { ventaIds: [b, a], instrumentos: [tr(700)] });
    expect((await info(a)).estado).toBe('COBRADA');
    const ib = await info(b);
    expect(ib.estado).toBe('PARCIAL');
    expect(ib.saldo).toBe(100);
    const cobros = await prisma.cobro.findMany({ where: { grupo }, include: { aplicaciones: true } });
    expect(cobros).toHaveLength(1);
    expect(cobros[0].estado).toBe('ACREDITADO');
    expect(cobros[0].aplicaciones.map((x) => Number(x.importe)).sort((x, y) => x - y)).toEqual([300, 400]);
    // Espejo en el historial de cada venta.
    expect(await prisma.auditLog.count({ where: { entidad: 'Movimiento', entidadId: { in: [a, b] }, accion: 'COBRO_REGISTRAR' } })).toBe(2);
  });

  it('no deja cobrar de más ni cobrar una venta ya cobrada', async () => {
    const a = await venta(100, '2026-07-02');
    await expect(registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(150)] })).rejects.toThrow(/supera el saldo/);
    await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(100)] });
    await expect(registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(1)] })).rejects.toThrow(/cobrada/);
  });

  it('dos cheques con fecha futura quedan en cartera; uno se acredita y otro se rechaza', async () => {
    const a = await venta(1000, '2026-08-01');
    const grupo = await registrarCobro(ctx, {
      ventaIds: [a],
      instrumentos: [
        tr(400, '2026-08-10', { instrumento: 'CHEQUE', numero: '111', fechaAcreditacion: d('2026-09-15') }),
        tr(600, '2026-08-10', { instrumento: 'ECHEQ', numero: '222', fechaAcreditacion: d('2026-10-15') }),
      ],
    });
    const [c1, c2] = await prisma.cobro.findMany({ where: { grupo }, orderBy: { monto: 'asc' } });
    expect([c1.estado, c2.estado]).toEqual(['EN_CARTERA', 'EN_CARTERA']);
    expect((await info(a)).estado).toBe('COBRADA'); // el cheque en cartera cancela la factura
    await acreditarCheque(ctx, c1.id, d('2026-09-16'));
    await rechazarCheque(ctx, c2.id, 'Sin fondos');
    const [r1, r2] = await prisma.cobro.findMany({ where: { grupo }, orderBy: { monto: 'asc' } });
    expect(r1.estado).toBe('ACREDITADO');
    expect(r1.fechaAcreditacion).toEqual(d('2026-09-16'));
    expect(r2.estado).toBe('RECHAZADO');
    const ia = await info(a);
    expect(ia.estado).toBe('PARCIAL'); // el rechazado vuelve a deberse
    expect(ia.saldo).toBe(600);
  });

  it('cerrar la diferencia como retención al registrar (caso Comnet) y en un clic después', async () => {
    const a = await venta(15136816.51, '2026-07-31');
    await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(14886621.17)], cerrarDiferenciaComoRetencion: true });
    expect((await info(a)).estado).toBe('COBRADA');
    const ret = await prisma.cobro.findFirst({ where: { empresaId, instrumento: 'RETENCION', aplicaciones: { some: { movimientoId: a } } } });
    expect(Number(ret!.monto)).toBe(250195.34);

    const b = await venta(5082000, '2026-07-31');
    await registrarCobro(ctx, { ventaIds: [b], instrumentos: [tr(4998000)] });
    expect((await info(b)).estado).toBe('PARCIAL');
    await cerrarSaldoComoRetencion(ctx, b, d('2026-08-05'));
    expect((await info(b)).estado).toBe('COBRADA');
  });

  it('factura en USD cobrada en pesos: genera el ajuste por diferencia de cambio y lo anula al deshacer', async () => {
    const e = await venta(24775.17, '2026-08-19', { moneda: 'USD', tipoCambio: 1495, tipoComprobante: 'FACTURA_E' });
    const grupo = await registrarCobro(ctx, { ventaIds: [e], instrumentos: [tr(36505077.66, '2026-08-19')] });
    expect((await info(e)).estado).toBe('COBRADA');
    const cobro = await prisma.cobro.findFirstOrThrow({ where: { grupo }, include: { aplicaciones: true } });
    expect(Number(cobro.tipoCambio)).toBeCloseTo(1473.4545, 3);
    const ajusteId = cobro.aplicaciones[0].ajusteId!;
    const ajuste = await prisma.movimiento.findUniqueOrThrow({ where: { id: ajusteId }, include: { categoria: true, lineas: true } });
    const esperado = Math.round((36505077.66 - 24775.17 * 1495) * 100) / 100;
    expect(Number(ajuste.total)).toBeCloseTo(esperado, 2);
    expect(ajuste.categoria?.nombre).toBe(CATEGORIA_DIFERENCIA_CAMBIO);
    expect(ajuste.origen).toBe('ASIENTO_MANUAL');
    expect(ajuste.estado).toBe('ASIGNADO');
    expect(ajuste.relacionadoId).toBe(e);
    expect(ajuste.lineas).toHaveLength(1);
    expect(ajuste.fechaDevengamiento).toEqual(d('2026-08-19'));

    await eliminarCobroGrupo(ctx, grupo);
    expect(await prisma.cobro.count({ where: { grupo } })).toBe(0);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: ajusteId } })).estado).toBe('ANULADO');
    expect((await info(e)).estado).toBe('PENDIENTE');
  });

  it('una segunda diferencia de cambio reutiliza la categoría', async () => {
    const e = await venta(100, '2026-08-20', { moneda: 'USD', tipoCambio: 1500, tipoComprobante: 'FACTURA_E' });
    await registrarCobro(ctx, { ventaIds: [e], instrumentos: [tr(152000, '2026-08-25')] });
    expect(await prisma.categoria.count({ where: { empresaId, nombre: CATEGORIA_DIFERENCIA_CAMBIO } })).toBe(1);
  });

  it('no se anula una venta con cobros; tampoco se mezclan monedas', async () => {
    const a = await venta(100, '2026-07-03');
    await registrarCobro(ctx, { ventaIds: [a], instrumentos: [tr(50)] });
    await expect(anularMovimiento(ctx, a, 'error')).rejects.toThrow(/cobros registrados/);
    const u = await venta(10, '2026-07-03', { moneda: 'USD', tipoCambio: 1500 });
    const b = await venta(10, '2026-07-03');
    await expect(registrarCobro(ctx, { ventaIds: [u, b], instrumentos: [tr(10)] })).rejects.toThrow(/misma moneda/);
  });

  it('fecha probable manual y plazo del cliente alimentan la fecha probable', async () => {
    const a = await venta(100, '2026-08-01');
    await fijarPlazoCliente(ctx, clienteId, 7);
    // el cliente ya tiene cobradas: pero el plazo explícito gana al histórico
    expect((await info(a)).fechaProbable).toEqual({ fecha: d('2026-08-08'), fuente: 'PLAZO_CLIENTE' });
    await fijarFechaProbable(ctx, a, d('2026-09-20'));
    expect((await info(a)).fechaProbable).toEqual({ fecha: d('2026-09-20'), fuente: 'MANUAL' });
    await fijarFechaProbable(ctx, a, null);
    await fijarPlazoCliente(ctx, clienteId, null);
    expect((await info(a)).fechaProbable?.fuente).toBe('HISTORICO');
    await expect(fijarPlazoCliente(ctx, clienteId, -3)).rejects.toThrow(DomainError);
  });

  it('otra empresa no ve ni toca los cobros', async () => {
    const otra = scopedDb('empresa-inexistente');
    expect(await otra.cobro.count()).toBe(0);
    expect(await otra.cobroAplicacion.count()).toBe(0);
  });
});
