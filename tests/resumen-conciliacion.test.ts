import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { conciliarLinea, imputarLinea, ignorarLinea, deshacerLinea, rechazarCandidato } from '@/lib/resumenes/service';
import { rematchearResumen } from '@/lib/resumenes/ingesta';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Conciliación de líneas: conciliar NO crea gasto (anti-duplicados), imputar
// crea un Movimiento origen RESUMEN que nace ASIGNADO, ignorar aparta con
// motivo, y todo se puede deshacer.

describe('conciliación de líneas de resumen (integración)', () => {
  const sufijo = `conc-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let resumenId: string;
  let movExistente: string;
  let categoriaId: string;
  let centroId: string;
  const linea = async (datos: Record<string, unknown> = {}) =>
    prisma.resumenLinea.create({
      data: { resumenId, orden: 99, descriptor: 'LINEA TEST', monto: -1000, moneda: 'ARS', fecha: new Date('2031-05-10T00:00:00Z'), ...datos } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Conc', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Conc SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    const periodo = await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 5 } });
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Gastos Test', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Centro Test', tipo: 'SOPORTE' } })).id;
    resumenId = (await prisma.resumen.create({
      data: { empresaId, tipo: 'TARJETA', emisor: 'Test', periodoId: periodo.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}` },
    })).id;
    movExistente = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 1000, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-09T00:00:00Z'), periodoId: periodo.id },
    })).id;
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

  it('conciliar vincula sin crear movimiento (anti-duplicados)', async () => {
    const l = await linea();
    const antes = await prisma.movimiento.count({ where: { empresaId } });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movExistente });
    expect(await prisma.movimiento.count({ where: { empresaId } })).toBe(antes);
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('CONCILIADA');
    expect(actual!.movimientoId).toBe(movExistente);
  });

  it('un movimiento admite UNA sola línea conciliada', async () => {
    const l2 = await linea();
    await expect(conciliarLinea(ctx, { lineaId: l2.id, movimientoId: movExistente })).rejects.toThrow(DomainError);
  });

  it('imputar crea un movimiento ASIGNADO origen RESUMEN', async () => {
    const l = await linea({ descriptor: 'SIRCREB', monto: -2210576.35 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id }, include: { movimiento: true } });
    expect(actual!.estado).toBe('IMPUTADA');
    expect(actual!.movimiento!.origen).toBe('RESUMEN');
    expect(actual!.movimiento!.estado).toBe('ASIGNADO');
    expect(Number(actual!.movimiento!.total)).toBeCloseTo(2210576.35, 2);
    expect(actual!.movimiento!.moneda).toBe('ARS');
  });

  it('imputar una línea USD sin pesos exige montoArs', async () => {
    const l = await linea({ monto: null, moneda: 'USD', montoOrigen: -50 });
    await expect(imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] })).rejects.toThrow(/pesos/);
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }], montoArs: 76000 });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id }, include: { movimiento: true } });
    expect(Number(actual!.movimiento!.total)).toBe(76000);
  });

  it('ignorar y deshacer', async () => {
    const l = await linea();
    await ignorarLinea(ctx, { lineaId: l.id, motivo: 'pago del resumen anterior' });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('IGNORADA');
    await deshacerLinea(ctx, { lineaId: l.id });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });

  it('deshacer una imputación anula el movimiento creado', async () => {
    const l = await linea({ descriptor: 'COMISION', monto: -500 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const movId = (await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.movimientoId!;
    await deshacerLinea(ctx, { lineaId: l.id });
    expect((await prisma.movimiento.findUnique({ where: { id: movId } }))!.estado).toBe('ANULADO');
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });

  it('una línea IGNORADA rechaza conciliar e imputar hasta deshacerla', async () => {
    const l = await linea({ descriptor: 'PAGO ANTERIOR' });
    await ignorarLinea(ctx, { lineaId: l.id, motivo: 'ya pagado en el resumen anterior' });
    await expect(conciliarLinea(ctx, { lineaId: l.id, movimientoId: movExistente })).rejects.toThrow(DomainError);
    await expect(
      imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] }),
    ).rejects.toThrow(DomainError);
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('IGNORADA');
    await deshacerLinea(ctx, { lineaId: l.id });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('PENDIENTE');
    expect(actual!.motivoIgnorada).toBeNull();
  });

  it('deshacer una imputación cuyo movimiento ya estaba ANULADO no re-anula (no-op) y libera la línea', async () => {
    const l = await linea({ descriptor: 'YA ANULADO', monto: -300 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const movId = (await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.movimientoId!;
    await prisma.movimiento.update({ where: { id: movId }, data: { estado: 'ANULADO', motivoAnulacion: 'anulado manualmente antes' } });
    await expect(deshacerLinea(ctx, { lineaId: l.id })).resolves.toBeUndefined();
    const mov = await prisma.movimiento.findUnique({ where: { id: movId } });
    expect(mov!.estado).toBe('ANULADO');
    expect(mov!.motivoAnulacion).toBe('anulado manualmente antes');
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });

  it('un movimiento IMPUTADA no es conciliable ni candidato para otra línea', async () => {
    const lA = await linea({ descriptor: 'OCUPA TEST', monto: -5000, fecha: new Date('2031-05-15T00:00:00Z') });
    await imputarLinea(ctx, { lineaId: lA.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const movId = (await prisma.resumenLinea.findUnique({ where: { id: lA.id } }))!.movimientoId!;

    const lB = await linea({ descriptor: 'OCUPA TEST', monto: -5000, fecha: new Date('2031-05-15T00:00:00Z') });
    await expect(conciliarLinea(ctx, { lineaId: lB.id, movimientoId: movId })).rejects.toThrow(DomainError);

    await rematchearResumen(ctx.db, resumenId);
    const actualB = await prisma.resumenLinea.findUnique({ where: { id: lB.id } });
    expect(actualB!.estado).toBe('PENDIENTE');
    const candidatosB = (actualB!.candidatos as { movimientoId: string }[] | null) ?? [];
    expect(candidatosB.some((c) => c.movimientoId === movId)).toBe(false);
  });

  it('rechazar una sugerencia la memoriza: el re-match no la vuelve a proponer', async () => {
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { email: `${sufijo}@test.local` } });
    const movNuevo = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 4321, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-12T00:00:00Z') },
    })).id;
    const l = await linea({
      descriptor: 'RECHAZO TEST',
      monto: -4321,
      fecha: new Date('2031-05-11T00:00:00Z'),
      estado: 'SUGERIDA',
      candidatos: [{ movimientoId: movNuevo, score: 0.9, motivo: 'monto exacto + fecha cercana' }],
    });

    await rechazarCandidato(ctx, { lineaId: l.id, movimientoId: movNuevo });

    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('PENDIENTE');
    const candidatos = actual!.candidatos as { movimientoId: string; rechazado?: boolean }[];
    expect(candidatos.find((c) => c.movimientoId === movNuevo)?.rechazado).toBe(true);
    expect(candidatos.some((c) => c.movimientoId === movNuevo && !c.rechazado)).toBe(false);

    // Re-matchear explícito: el rechazo persiste y no vuelve a sugerir.
    await rematchearResumen(ctx.db, resumenId);
    const despues = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(despues!.estado).toBe('PENDIENTE');
    const cand2 = despues!.candidatos as { movimientoId: string; rechazado?: boolean }[];
    expect(cand2.some((c) => c.movimientoId === movNuevo && !c.rechazado)).toBe(false);
    expect(cand2.find((c) => c.movimientoId === movNuevo)?.rechazado).toBe(true);

    // Rechazar de nuevo (ya no es candidato activo) falla.
    await expect(rechazarCandidato(ctx, { lineaId: l.id, movimientoId: movNuevo })).rejects.toThrow(DomainError);
  });

  it('rechazado el primero, la línea queda SUGERIDA con el siguiente candidato que califica', async () => {
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { email: `${sufijo}@test.local` } });
    const movA = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 777, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-12T00:00:00Z') },
    })).id;
    const movB = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 777, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-14T00:00:00Z') },
    })).id;
    const l = await linea({ descriptor: 'DOBLE CANDIDATO', monto: -777, fecha: new Date('2031-05-12T00:00:00Z') });

    await rematchearResumen(ctx.db, resumenId);
    let actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('SUGERIDA');
    let candidatos = actual!.candidatos as { movimientoId: string; rechazado?: boolean }[];
    expect(candidatos.filter((c) => !c.rechazado)[0]?.movimientoId).toBe(movA); // fecha más cercana gana

    await rechazarCandidato(ctx, { lineaId: l.id, movimientoId: movA });
    actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('SUGERIDA'); // el siguiente también califica
    candidatos = actual!.candidatos as { movimientoId: string; rechazado?: boolean }[];
    expect(candidatos.filter((c) => !c.rechazado)[0]?.movimientoId).toBe(movB);
    expect(candidatos.find((c) => c.movimientoId === movA)?.rechazado).toBe(true);
  });

  it('rechazar un movimiento que no es candidato activo falla', async () => {
    const l = await linea({ descriptor: 'SIN CANDIDATOS' });
    await expect(rechazarCandidato(ctx, { lineaId: l.id, movimientoId: movExistente })).rejects.toThrow(DomainError);
  });

  it('rechaza imputar con período cerrado', async () => {
    await prisma.periodo.updateMany({ where: { empresaId }, data: { estado: 'CERRADO' } });
    const l = await linea({ descriptor: 'PERIODO CERRADO', monto: -700 });
    await expect(
      imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] }),
    ).rejects.toThrow(/cerrado/);
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('PENDIENTE');
    expect(actual!.movimientoId).toBeNull();
    await prisma.periodo.updateMany({ where: { empresaId }, data: { estado: 'ABIERTO' } });
  });
});
