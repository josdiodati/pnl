import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { puedeTransicionar } from '@/lib/movimientos/estados';
import { ingestarComprobante } from '@/lib/pipeline';
import { volverAPendiente } from '@/lib/movimientos/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';

// Duplicado a nivel ARCHIVO: el mismo archivo (hash) ingresado de nuevo va
// directo a DUPLICADO sin re-procesar. La sugerencia de posible duplicado por
// valores (CUIT+tipo+PV+nº) no cambia.

describe('transiciones para duplicado de archivo', () => {
  it('la ingesta puede mandar directo a DUPLICADO', () => {
    expect(puedeTransicionar('INGRESADO', 'DUPLICADO')).toBe(true);
  });
  it('un duplicado de archivo recuperado vuelve al pipeline (INGRESADO)', () => {
    expect(puedeTransicionar('DUPLICADO', 'INGRESADO')).toBe(true);
  });
  it('lo demás no se relaja', () => {
    expect(puedeTransicionar('INGRESADO', 'PENDIENTE_VALIDACION')).toBe(false);
    expect(puedeTransicionar('INGRESADO', 'VALIDADO')).toBe(false);
  });
});

describe('ingesta con archivo duplicado (integración contra la base)', () => {
  const sufijo = `dup-arch-${Date.now()}`;
  const pdfA = Buffer.from(`%PDF-1.4 contenido A ${sufijo}`);
  const pdfB = Buffer.from(`%PDF-1.4 contenido B ${sufijo}`);
  let empresaId: string;
  let otraEmpresaId: string;
  let usuarioId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({
      data: { email: `${sufijo}@test.local`, nombre: 'Test Dup Archivo', passwordHash: 'x' },
    });
    usuarioId = usuario.id;
    const a = await prisma.empresa.create({
      data: { slug: `${sufijo}-a`, razonSocial: 'Dup Archivo A', cuit: '30714325651' },
    });
    const b = await prisma.empresa.create({
      data: { slug: `${sufijo}-b`, razonSocial: 'Dup Archivo B', cuit: '20128364847' },
    });
    empresaId = a.id;
    otraEmpresaId = b.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { empresaId: { in: [empresaId, otraEmpresaId] } } });
    await prisma.movimiento.deleteMany({ where: { empresaId: { in: [empresaId, otraEmpresaId] } } });
    await prisma.auditLog.deleteMany({ where: { empresaId: { in: [empresaId, otraEmpresaId] } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresaId, otraEmpresaId] } } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  const ingestar = (buffer: Buffer, empresa = empresaId, filename = 'factura.pdf') =>
    ingestarComprobante({ empresaId: empresa, usuarioId, buffer, filename, mime: 'application/pdf', canal: 'WEB' });

  it('el mismo archivo por segunda vez va directo a DUPLICADO sin encolar extracción', async () => {
    const primero = await ingestar(pdfA);
    const segundo = await ingestar(pdfA);

    const movPrimero = await prisma.movimiento.findUnique({ where: { id: primero.movimientoId } });
    const movSegundo = await prisma.movimiento.findUnique({ where: { id: segundo.movimientoId } });
    expect(movPrimero!.estado).toBe('INGRESADO');
    expect(movSegundo!.estado).toBe('DUPLICADO');
    expect((movSegundo!.flags as { duplicadoArchivo?: string }).duplicadoArchivo).toBe(primero.movimientoId);

    const jobsSegundo = await prisma.job.findMany({
      where: { tipo: 'EXTRACCION', payload: { path: ['movimientoId'], equals: segundo.movimientoId } },
    });
    expect(jobsSegundo).toHaveLength(0);
    const jobsPrimero = await prisma.job.findMany({
      where: { tipo: 'EXTRACCION', payload: { path: ['movimientoId'], equals: primero.movimientoId } },
    });
    expect(jobsPrimero).toHaveLength(1);
  });

  it('un archivo distinto entra normal', async () => {
    const r = await ingestar(pdfB);
    const mov = await prisma.movimiento.findUnique({ where: { id: r.movimientoId } });
    expect(mov!.estado).toBe('INGRESADO');
  });

  it('el mismo archivo en OTRA empresa no es duplicado (aislamiento)', async () => {
    const r = await ingestar(pdfA, otraEmpresaId);
    const mov = await prisma.movimiento.findUnique({ where: { id: r.movimientoId } });
    expect(mov!.estado).toBe('INGRESADO');
  });

  it('si el original está ANULADO, re-subir el archivo se procesa normal', async () => {
    const pdfC = Buffer.from(`%PDF-1.4 contenido C ${sufijo}`);
    const primero = await ingestar(pdfC);
    await prisma.movimiento.update({ where: { id: primero.movimientoId }, data: { estado: 'ANULADO' } });
    const segundo = await ingestar(pdfC);
    const mov = await prisma.movimiento.findUnique({ where: { id: segundo.movimientoId } });
    expect(mov!.estado).toBe('INGRESADO');
  });

  it('recuperar un duplicado de archivo lo devuelve al pipeline y re-encola la extracción', async () => {
    const pdfD = Buffer.from(`%PDF-1.4 contenido D ${sufijo}`);
    await ingestar(pdfD);
    const dup = await ingestar(pdfD);

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    const ctx = {
      empresa: empresa!,
      usuario: { id: usuario!.id, email: usuario!.email, nombre: usuario!.nombre },
      rol: 'VALIDADOR',
      db: scopedDb(empresaId),
    } as EmpresaContext;
    await volverAPendiente(ctx, dup.movimientoId, 'no era duplicado');

    const mov = await prisma.movimiento.findUnique({ where: { id: dup.movimientoId } });
    expect(mov!.estado).toBe('INGRESADO');
    const jobs = await prisma.job.findMany({
      where: { tipo: 'EXTRACCION', payload: { path: ['movimientoId'], equals: dup.movimientoId } },
    });
    expect(jobs).toHaveLength(1);
  });

  it('un duplicado por VALORES (ya extraído) recuperado sigue yendo a PENDIENTE_VALIDACION', async () => {
    const mov = await prisma.movimiento.create({
      data: {
        empresaId,
        origen: 'COMPROBANTE',
        estado: 'DUPLICADO',
        creadoPorId: usuarioId,
        extraccionRaw: { total: 1 },
        total: 1,
      },
    });
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const ctx = {
      empresa: empresa!,
      usuario: { id: usuarioId, email: 'x@x', nombre: 'x' },
      rol: 'VALIDADOR',
      db: scopedDb(empresaId),
    } as EmpresaContext;
    await volverAPendiente(ctx, mov.id);
    const actualizado = await prisma.movimiento.findUnique({ where: { id: mov.id } });
    expect(actualizado!.estado).toBe('PENDIENTE_VALIDACION');
  });
});
