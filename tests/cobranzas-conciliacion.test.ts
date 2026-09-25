import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { conciliarLinea, conciliarLineaConVentas, desvincularLinea, deshacerLinea } from '@/lib/resumenes/service';
import { rematchearResumen } from '@/lib/resumenes/ingesta';
import { registrarCobro, eliminarCobroGrupo } from '@/lib/cobranzas/service';
import { mapaCobranza } from '@/lib/cobranzas/query';

// Etapa 3 (Spec F): el resumen confirma cobros registrados o crea los suyos.

describe('cobranzas: conciliación con el resumen (integración)', () => {
  const sufijo = `cobcon-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let usuarioId: string;
  let resumenId: string;
  let categoriaId: string;
  let centroId: string;
  let clienteId: string;
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  const periodoDe = async (f: Date) =>
    (await prisma.periodo.findFirst({ where: { empresaId, anio: f.getUTCFullYear(), mes: f.getUTCMonth() + 1 } }))
    ?? (await prisma.periodo.create({ data: { empresaId, anio: f.getUTCFullYear(), mes: f.getUTCMonth() + 1 } }));
  const venta = async (total: number, fecha: string, over: Record<string, unknown> = {}) => {
    const f = d(fecha);
    return (await prisma.movimiento.create({
      data: {
        empresaId, origen: 'VENTA_COMPROBANTE', estado: 'ASIGNADO', total, creadoPorId: usuarioId, fechaDevengamiento: f,
        periodoId: (await periodoDe(f)).id, categoriaId, contraparteId: clienteId, tipoComprobante: 'FACTURA_A',
        lineas: { create: [{ centroCostoId: centroId, porcentaje: 100 }] }, ...(over as object),
      } as never,
    })).id;
  };
  const linea = async (monto: number, fecha: string, descriptor = 'Pago a proveedores recibido Comnet sa 30661571663') =>
    prisma.resumenLinea.create({ data: { resumenId, orden: 1, descriptor, monto, moneda: 'ARS', fecha: d(fecha) } });
  const info = async (id: string) => (await mapaCobranza(ctx.db, d('2026-09-01'))).get(id)!;
  const cobrosDeLinea = (lineaId: string) => prisma.cobro.findMany({ where: { resumenLineaId: lineaId }, include: { aplicaciones: true }, orderBy: { instrumento: 'asc' } });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test CobCon', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'CobCon SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Ventas CobCon', tipo: 'INGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Centro CobCon', tipo: 'NEGOCIO' } })).id;
    clienteId = (await prisma.contraparte.create({ data: { empresaId, cuit: '30661571663', razonSocial: 'COMNET S A', tipo: 'CLIENTE' } })).id;
    resumenId = (await prisma.resumen.create({
      data: {
        empresaId, tipo: 'BANCO', emisor: 'Galicia', periodoId: (await periodoDe(d('2026-08-01'))).id, estado: 'EXTRAIDO',
        verificacionTitular: 'COINCIDE', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}`,
      },
    })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.cobro.deleteMany({ where: { empresaId } });
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
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

  it('crédito neto de retenciones: crea transferencia + retención y la venta queda cobrada; deshacer la deja pendiente', async () => {
    const v = await venta(15136816.51, '2026-07-31');
    const l = await linea(14886621.17, '2026-08-13');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: v });
    const cobros = await cobrosDeLinea(l.id);
    expect(cobros.map((c) => [c.instrumento, Number(c.monto), c.origen])).toEqual([
      ['TRANSFERENCIA', 14886621.17, 'RESUMEN'],
      ['RETENCION', 250195.34, 'RESUMEN'],
    ]);
    expect((await info(v)).estado).toBe('COBRADA');

    await deshacerLinea(ctx, { lineaId: l.id });
    expect(await cobrosDeLinea(l.id)).toHaveLength(0);
    expect((await info(v)).estado).toBe('PENDIENTE');
  });

  it('un crédito muy por debajo del saldo deja la venta parcial (sin retención automática)', async () => {
    const v = await venta(1000, '2026-08-01');
    const l = await linea(500, '2026-08-05');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: v });
    const i = await info(v);
    expect(i.estado).toBe('PARCIAL');
    expect(i.saldo).toBe(500);
  });

  it('una línea que paga dos ventas se recalcula al sumar y al desvincular', async () => {
    const a = await venta(300, '2026-07-01');
    const b = await venta(500, '2026-07-02');
    const l = await linea(800, '2026-08-06');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: a });
    expect((await info(a)).estado).toBe('COBRADA');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: b });
    expect((await info(b)).estado).toBe('COBRADA');
    const cobros = await cobrosDeLinea(l.id);
    expect(cobros).toHaveLength(1);
    expect(cobros[0].aplicaciones.map((x) => Number(x.importe)).sort((x, y) => x - y)).toEqual([300, 500]);
    await desvincularLinea(ctx, { lineaId: l.id, movimientoId: a });
    expect((await info(a)).estado).toBe('PENDIENTE');
    expect((await info(b)).estado).toBe('COBRADA');
  });

  it('factura en USD cobrada por Comex en pesos: cobro con cotización implícita y ajuste de cambio', async () => {
    const e = await venta(24775.17, '2026-08-19', { moneda: 'USD', tipoCambio: 1495, tipoComprobante: 'FACTURA_E' });
    const l = await linea(36505077.66, '2026-08-19', '25333911 Comex - cobro exportacion de serv');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: e });
    expect((await info(e)).estado).toBe('COBRADA');
    const [c] = await cobrosDeLinea(l.id);
    const ajuste = await prisma.movimiento.findUniqueOrThrow({ where: { id: c.aplicaciones[0].ajusteId! } });
    expect(Number(ajuste.total)).toBeCloseTo(36505077.66 - 24775.17 * 1495, 1);
    await deshacerLinea(ctx, { lineaId: l.id });
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: ajuste.id } })).estado).toBe('ANULADO');
  });

  it('un cheque registrado se confirma con el crédito del banco y no se duplica el cobro', async () => {
    const v = await venta(1000, '2026-08-01');
    const grupo = await registrarCobro(ctx, {
      ventaIds: [v],
      instrumentos: [{ instrumento: 'CHEQUE', monto: 1000, moneda: 'ARS', fecha: d('2026-08-02'), fechaAcreditacion: d('2026-08-20'), numero: '777' }],
    });
    const l = await linea(1000, '2026-08-21', 'DEPOSITO CHEQUE 777');
    // El matching lo propone como cobro registrado.
    await rematchearResumen(ctx.db, resumenId);
    const sug = await prisma.resumenLinea.findUniqueOrThrow({ where: { id: l.id } });
    expect(sug.estado).toBe('SUGERIDA');
    expect(JSON.stringify(sug.candidatos)).toContain('cobro registrado: Cheque 777');

    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: v });
    const cobros = await prisma.cobro.findMany({ where: { grupo } });
    expect(cobros[0].resumenLineaId).toBe(l.id);
    expect(cobros[0].estado).toBe('ACREDITADO');
    expect(cobros[0].fechaAcreditacion).toEqual(d('2026-08-21'));
    expect(await prisma.cobro.count({ where: { resumenLineaId: l.id, origen: 'RESUMEN' } })).toBe(0);
    await expect(eliminarCobroGrupo(ctx, grupo)).rejects.toThrow(/resumen bancario/);

    await deshacerLinea(ctx, { lineaId: l.id });
    const [despues] = await prisma.cobro.findMany({ where: { grupo } });
    expect(despues.resumenLineaId).toBeNull();
    expect(despues.estado).toBe('EN_CARTERA');
    expect((await info(v)).estado).toBe('COBRADA'); // sigue cobrada por el cheque en cartera
  });

  it('una transferencia registrada para dos ventas vincula la línea a ambas', async () => {
    const a = await venta(300, '2026-07-05');
    const b = await venta(500, '2026-07-06');
    await registrarCobro(ctx, { ventaIds: [a, b], instrumentos: [{ instrumento: 'TRANSFERENCIA', monto: 800, moneda: 'ARS', fecha: d('2026-08-07'), fechaAcreditacion: d('2026-08-07') }] });
    const l = await linea(800, '2026-08-07');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: a });
    const vinc = await prisma.resumenLineaVinculo.findMany({ where: { lineaId: l.id } });
    expect(vinc.map((x) => x.movimientoId).sort()).toEqual([a, b].sort());
    expect(await prisma.cobro.count({ where: { resumenLineaId: l.id, origen: 'RESUMEN' } })).toBe(0);
  });

  it('Cobro de facturas: un crédito contra tres ventas en un paso, neto de retenciones', async () => {
    const a = await venta(1000, '2026-06-01');
    const b = await venta(2000, '2026-06-02');
    const c = await venta(3000, '2026-06-03');
    const l = await linea(5900, '2026-06-20');
    await conciliarLineaConVentas(ctx, { lineaId: l.id, ventaIds: [c, a, b] });
    expect((await prisma.resumenLinea.findUniqueOrThrow({ where: { id: l.id } })).estado).toBe('CONCILIADA');
    for (const v of [a, b, c]) expect((await info(v)).estado).toBe('COBRADA');
    const cobros = await cobrosDeLinea(l.id);
    expect(cobros.map((x) => [x.instrumento, Number(x.monto)])).toEqual([['TRANSFERENCIA', 5900], ['RETENCION', 100]]);
  });

  it('Cobro de facturas rechaza débitos y comprobantes que no son ventas', async () => {
    const gasto = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 10, creadoPorId: usuarioId, fechaDevengamiento: d('2026-06-01'), periodoId: (await periodoDe(d('2026-06-01'))).id },
    })).id;
    const credito = await linea(10, '2026-06-05');
    await expect(conciliarLineaConVentas(ctx, { lineaId: credito.id, ventaIds: [gasto] })).rejects.toThrow(/facturas de venta/);
    const debito = await linea(-10, '2026-06-05');
    await expect(conciliarLineaConVentas(ctx, { lineaId: debito.id, ventaIds: [gasto] })).rejects.toThrow(/crédito/);
  });

  it('un débito conciliado contra un gasto no crea cobros', async () => {
    const gasto = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 100, creadoPorId: usuarioId, fechaDevengamiento: d('2026-08-01'), periodoId: (await periodoDe(d('2026-08-01'))).id },
    })).id;
    const l = await linea(-100, '2026-08-02', 'DEBITO');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: gasto });
    expect(await cobrosDeLinea(l.id)).toHaveLength(0);
  });
});
