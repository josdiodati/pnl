import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import {
  conciliarLinea,
  imputarLinea,
  ignorarLinea,
  deshacerLinea,
  desvincularLinea,
  eliminarResumen,
  confirmarTitularResumen,
} from '@/lib/resumenes/service';
import { rematchearResumen } from '@/lib/resumenes/ingesta';
import { eliminarDuplicado } from '@/lib/movimientos/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Vínculos línea ↔ comprobante N:M: un comprobante pagado en varias líneas
// (pagos parciales, con confirmación explícita) y una línea que paga varios
// comprobantes. Eliminación de resúmenes con doble validación y bloqueo de
// resúmenes cuyo titular no coincide con la empresa.

describe('vínculos N:M entre líneas de resumen y comprobantes (integración)', () => {
  const sufijo = `vinc-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let usuarioId: string;
  let periodoId: string;
  let resumenId: string;
  let categoriaId: string;
  let centroId: string;

  const linea = async (datos: Record<string, unknown> = {}) =>
    prisma.resumenLinea.create({
      data: { resumenId, orden: 99, descriptor: 'LINEA VINC', monto: -1000, moneda: 'ARS', fecha: new Date('2032-03-10T00:00:00Z'), ...(datos as object) } as never,
    });
  const comprobante = async (total: number) =>
    (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total, creadoPorId: usuarioId, fechaDevengamiento: new Date('2032-03-09T00:00:00Z'), periodoId },
    })).id;
  const vinculosDe = (lineaId: string) => prisma.resumenLineaVinculo.findMany({ where: { lineaId }, orderBy: { createdAt: 'asc' } });
  const estadoDe = async (lineaId: string) => (await prisma.resumenLinea.findUniqueOrThrow({ where: { id: lineaId } })).estado;
  const nuevoResumen = async (datos: Record<string, unknown> = {}) =>
    prisma.resumen.create({
      data: {
        empresaId, tipo: 'BANCO', emisor: 'Otro', periodoId, estado: 'EXTRAIDO',
        archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}-${Math.random()}`,
        ...(datos as object),
      } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Vinc', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Vinc SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    periodoId = (await prisma.periodo.create({ data: { empresaId, anio: 2032, mes: 3 } })).id;
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Gastos Vinc', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Centro Vinc', tipo: 'SOPORTE' } })).id;
    resumenId = (await nuevoResumen({ emisor: 'Principal' })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  // ---------- un comprobante, varias líneas ----------

  it('conciliar crea el vínculo en la tabla N:M y la línea queda CONCILIADA', async () => {
    const mov = await comprobante(1000);
    const l = await linea();
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov });
    expect(await estadoDe(l.id)).toBe('CONCILIADA');
    expect((await vinculosDe(l.id)).map((v) => v.movimientoId)).toEqual([mov]);
  });

  it('un comprobante ya vinculado a otra línea exige confirmación explícita', async () => {
    const mov = await comprobante(3000);
    const l1 = await linea({ monto: -1000 });
    const l2 = await linea({ monto: -2000 });
    await conciliarLinea(ctx, { lineaId: l1.id, movimientoId: mov });
    await expect(conciliarLinea(ctx, { lineaId: l2.id, movimientoId: mov })).rejects.toThrow(/ya está vinculado/i);
    expect(await estadoDe(l2.id)).toBe('PENDIENTE');

    await conciliarLinea(ctx, { lineaId: l2.id, movimientoId: mov, confirmarCompartido: true });
    expect(await estadoDe(l2.id)).toBe('CONCILIADA');
    const vinculosMov = await prisma.resumenLineaVinculo.findMany({ where: { movimientoId: mov } });
    expect(vinculosMov.map((v) => v.lineaId).sort()).toEqual([l1.id, l2.id].sort());
    const audit = await prisma.auditLog.findFirst({
      where: { empresaId, accion: 'RESUMEN_CONCILIAR', despues: { path: ['lineaId'], equals: l2.id } },
    });
    expect((audit!.despues as { compartido?: boolean }).compartido).toBe(true);
  });

  it('un comprobante nacido de una imputación no se comparte ni con confirmación', async () => {
    const lA = await linea({ descriptor: 'IMPUTADA VINC', monto: -5000 });
    await imputarLinea(ctx, { lineaId: lA.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const vinculos = await vinculosDe(lA.id);
    expect(vinculos).toHaveLength(1);
    expect(await estadoDe(lA.id)).toBe('IMPUTADA');

    const lB = await linea({ monto: -5000 });
    await expect(conciliarLinea(ctx, { lineaId: lB.id, movimientoId: vinculos[0].movimientoId, confirmarCompartido: true })).rejects.toThrow(DomainError);
  });

  // ---------- una línea, varios comprobantes ----------

  it('una línea CONCILIADA puede sumar otro comprobante', async () => {
    const movA = await comprobante(400);
    const movB = await comprobante(600);
    const l = await linea({ monto: -1000 });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movA });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movB });
    expect(await estadoDe(l.id)).toBe('CONCILIADA');
    expect((await vinculosDe(l.id)).map((v) => v.movimientoId)).toEqual([movA, movB]);
  });

  it('el mismo comprobante no se vincula dos veces a la misma línea', async () => {
    const mov = await comprobante(1000);
    const l = await linea();
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov });
    await expect(conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov, confirmarCompartido: true })).rejects.toThrow(/esta línea/i);
    expect(await vinculosDe(l.id)).toHaveLength(1);
  });

  it('una línea IMPUTADA no admite comprobantes adicionales', async () => {
    const l = await linea({ descriptor: 'IMPUTADA SOLA', monto: -700 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const mov = await comprobante(700);
    await expect(conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov })).rejects.toThrow(DomainError);
  });

  it('desvincular un comprobante deja la línea CONCILIADA si quedan otros, y PENDIENTE si no queda ninguno', async () => {
    const movA = await comprobante(400);
    const movB = await comprobante(600);
    const l = await linea({ monto: -1000 });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movA });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movB });

    await desvincularLinea(ctx, { lineaId: l.id, movimientoId: movA });
    expect(await estadoDe(l.id)).toBe('CONCILIADA');
    expect((await vinculosDe(l.id)).map((v) => v.movimientoId)).toEqual([movB]);

    await desvincularLinea(ctx, { lineaId: l.id, movimientoId: movB });
    expect(await estadoDe(l.id)).toBe('PENDIENTE');
    expect(await vinculosDe(l.id)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { empresaId, accion: 'RESUMEN_DESVINCULAR', despues: { path: ['lineaId'], equals: l.id } } })).toBe(2);
  });

  it('desvincular una IMPUTADA no está permitido (se deshace, que anula el comprobante creado)', async () => {
    const l = await linea({ descriptor: 'IMPUTADA DESV', monto: -300 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const [v] = await vinculosDe(l.id);
    await expect(desvincularLinea(ctx, { lineaId: l.id, movimientoId: v.movimientoId })).rejects.toThrow(DomainError);
  });

  it('deshacer borra todos los vínculos de la línea sin tocar los comprobantes conciliados', async () => {
    const movA = await comprobante(400);
    const movB = await comprobante(600);
    const l = await linea({ monto: -1000 });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movA });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movB });
    await deshacerLinea(ctx, { lineaId: l.id });
    expect(await estadoDe(l.id)).toBe('PENDIENTE');
    expect(await vinculosDe(l.id)).toHaveLength(0);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: movA } })).estado).toBe('ASIGNADO');
  });

  it('el matching sigue excluyendo los comprobantes que ya tienen algún vínculo', async () => {
    const mov = await comprobante(8800);
    const l1 = await linea({ descriptor: 'OCUPADO', monto: -8800 });
    await conciliarLinea(ctx, { lineaId: l1.id, movimientoId: mov });
    const l2 = await linea({ descriptor: 'OCUPADO', monto: -8800 });
    await rematchearResumen(ctx.db, resumenId);
    const actual = await prisma.resumenLinea.findUniqueOrThrow({ where: { id: l2.id } });
    const candidatos = (actual.candidatos as { movimientoId: string }[] | null) ?? [];
    expect(candidatos.some((c) => c.movimientoId === mov)).toBe(false);
  });

  it('borrar un DUPLICADO deja PENDIENTE a la línea que se quedó sin comprobantes', async () => {
    const mov = await comprobante(1000);
    const l = await linea();
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov });
    await prisma.movimiento.update({ where: { id: mov }, data: { estado: 'DUPLICADO' } });
    await eliminarDuplicado(ctx, mov);
    expect(await estadoDe(l.id)).toBe('PENDIENTE');
    expect(await vinculosDe(l.id)).toHaveLength(0);
  });

  // ---------- eliminar resumen ----------

  it('eliminar un resumen exige la palabra de confirmación', async () => {
    const r = await nuevoResumen();
    await expect(eliminarResumen(ctx, { resumenId: r.id, confirmacion: 'eliminar' })).rejects.toThrow(/ELIMINAR/);
    expect(await prisma.resumen.findUnique({ where: { id: r.id } })).not.toBeNull();
  });

  it('un resumen con líneas vinculadas a comprobantes no se elimina', async () => {
    const r = await nuevoResumen();
    const mov = await comprobante(1000);
    const l = await prisma.resumenLinea.create({ data: { resumenId: r.id, orden: 0, descriptor: 'X', monto: -1000, moneda: 'ARS' } as never });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov });
    await expect(eliminarResumen(ctx, { resumenId: r.id, confirmacion: 'ELIMINAR' })).rejects.toThrow(/comprobante/i);
    expect(await prisma.resumen.findUnique({ where: { id: r.id } })).not.toBeNull();
  });

  it('un resumen en procesamiento no se elimina', async () => {
    const r = await nuevoResumen({ estado: 'PROCESANDO' });
    await expect(eliminarResumen(ctx, { resumenId: r.id, confirmacion: 'ELIMINAR' })).rejects.toThrow(DomainError);
  });

  it('eliminar borra el resumen con sus líneas pendientes e ignoradas y lo audita', async () => {
    const r = await nuevoResumen({ emisor: 'A borrar' });
    await prisma.resumenLinea.create({ data: { resumenId: r.id, orden: 0, descriptor: 'P', monto: -1, moneda: 'ARS' } as never });
    await prisma.resumenLinea.create({ data: { resumenId: r.id, orden: 1, descriptor: 'I', monto: -1, moneda: 'ARS', estado: 'IGNORADA', motivoIgnorada: 'Cobros' } as never });
    await eliminarResumen(ctx, { resumenId: r.id, confirmacion: 'ELIMINAR' });
    expect(await prisma.resumen.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await prisma.resumenLinea.count({ where: { resumenId: r.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { empresaId, entidad: 'Resumen', entidadId: r.id, accion: 'ELIMINAR' } });
    expect(audit).not.toBeNull();
    expect((audit!.antes as { emisor: string; lineas: number }).emisor).toBe('A borrar');
    expect((audit!.antes as { emisor: string; lineas: number }).lineas).toBe(2);
  });

  it('no se puede eliminar un resumen de otra empresa', async () => {
    const otra = await prisma.empresa.create({ data: { slug: `${sufijo}-otra`, razonSocial: 'Otra SA', cuit: '30714325651' } });
    const periodoOtra = await prisma.periodo.create({ data: { empresaId: otra.id, anio: 2032, mes: 3 } });
    const r = await prisma.resumen.create({
      data: { empresaId: otra.id, tipo: 'BANCO', emisor: 'Ajeno', periodoId: periodoOtra.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-otra-${sufijo}` },
    });
    try {
      await expect(eliminarResumen(ctx, { resumenId: r.id, confirmacion: 'ELIMINAR' })).rejects.toThrow(DomainError);
      expect(await prisma.resumen.findUnique({ where: { id: r.id } })).not.toBeNull();
    } finally {
      await prisma.resumen.deleteMany({ where: { empresaId: otra.id } });
      await prisma.periodo.deleteMany({ where: { empresaId: otra.id } });
      await prisma.auditLog.deleteMany({ where: { empresaId: otra.id } });
      await prisma.empresa.delete({ where: { id: otra.id } });
    }
  });

  // ---------- titular que no coincide ----------

  it('un resumen NO_COINCIDE bloquea conciliar, imputar e ignorar hasta confirmarlo', async () => {
    const r = await nuevoResumen({ verificacionTitular: 'NO_COINCIDE', titularDetectado: 'ARBOLITO ROJO S.R.L.' });
    const l = await prisma.resumenLinea.create({ data: { resumenId: r.id, orden: 0, descriptor: 'X', monto: -1000, moneda: 'ARS' } as never });
    const mov = await comprobante(1000);
    await expect(conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov })).rejects.toThrow(/otra empresa/i);
    await expect(imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] })).rejects.toThrow(/otra empresa/i);
    await expect(ignorarLinea(ctx, { lineaId: l.id, motivo: 'Cobros' })).rejects.toThrow(/otra empresa/i);

    await confirmarTitularResumen(ctx, { resumenId: r.id });
    const actual = await prisma.resumen.findUniqueOrThrow({ where: { id: r.id } });
    expect(actual.verificacionTitular).toBe('CONFIRMADA');
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: mov });
    expect(await estadoDe(l.id)).toBe('CONCILIADA');
    expect(await prisma.auditLog.count({ where: { empresaId, entidad: 'Resumen', entidadId: r.id, accion: 'RESUMEN_CONFIRMAR_TITULAR' } })).toBe(1);
  });
});
