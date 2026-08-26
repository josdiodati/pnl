import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { applyEmpresaScope } from '@/lib/empresa/scope';
import { resumirLote } from '@/lib/movimientos/lotes';
import { ingestarComprobante } from '@/lib/pipeline';

// Lotes de ingesta: cada "vez que se procesan archivos" (un drop web, un mail,
// un mensaje de Telegram) agrupa sus movimientos para mostrar progreso y
// resultados en /carga. Sin contadores materializados: todo se deriva por query.

describe('resumirLote (puro)', () => {
  const mov = (estado: string, flags: unknown = null) => ({ estado, flags });

  it('separa en curso de terminados y agrupa resultados', () => {
    const r = resumirLote([
      mov('INGRESADO'),
      mov('PROCESANDO'),
      mov('PENDIENTE_VALIDACION'),
      mov('VALIDADO'),
      mov('ASIGNADO'),
      mov('OBSERVADO'),
      mov('RETENIDO'),
      mov('ERROR_PROCESAMIENTO'),
    ]);
    expect(r.total).toBe(8);
    expect(r.enProceso).toBe(2);
    expect(r.resultados).toEqual([
      { clave: 'pendientes', cantidad: 1 },
      { clave: 'auto-validados', cantidad: 1 },
      { clave: 'auto-asignados', cantidad: 1 },
      { clave: 'observados', cantidad: 1 },
      { clave: 'retenidos', cantidad: 1 },
      { clave: 'errores', cantidad: 1 },
    ]);
  });

  it('distingue archivo duplicado de duplicado por valores', () => {
    const r = resumirLote([
      mov('DUPLICADO', { duplicadoArchivo: 'otro-id' }),
      mov('DUPLICADO', { duplicadoArchivo: 'otro-id' }),
      mov('DUPLICADO', { duplicados: ['x'] }),
    ]);
    expect(r.resultados).toEqual([
      { clave: 'archivo-duplicado', cantidad: 2 },
      { clave: 'duplicados', cantidad: 1 },
    ]);
  });

  it('lote vacío: total 0, sin resultados', () => {
    const r = resumirLote([]);
    expect(r.total).toBe(0);
    expect(r.enProceso).toBe(0);
    expect(r.resultados).toEqual([]);
  });
});

describe('scope de LoteIngesta', () => {
  it('LoteIngesta es un modelo scoped por empresa', () => {
    expect(applyEmpresaScope('LoteIngesta', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    const creado = applyEmpresaScope('LoteIngesta', 'create', { data: { canal: 'WEB' } }, 'emp1');
    expect(creado.data.empresaId).toBe('emp1');
  });
});

describe('ingesta con lote (integración contra la base)', () => {
  const sufijo = `lote-${Date.now()}`;
  let empresaId: string;
  let usuarioId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({
      data: { email: `${sufijo}@test.local`, nombre: 'Test Lotes', passwordHash: 'x' },
    });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({
      data: { slug: sufijo, razonSocial: 'Lotes SA', cuit: '30714325651' },
    });
    empresaId = empresa.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { empresaId } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.loteIngesta.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  it('los movimientos de una ingesta quedan vinculados a su lote', async () => {
    const lote = await prisma.loteIngesta.create({
      data: { empresaId, canal: 'WEB', creadoPorId: usuarioId, archivos: 2 },
    });
    const a = await ingestarComprobante({
      empresaId,
      usuarioId,
      buffer: Buffer.from(`%PDF a ${sufijo}`),
      filename: 'a.pdf',
      mime: 'application/pdf',
      canal: 'WEB',
      loteId: lote.id,
    });
    const b = await ingestarComprobante({
      empresaId,
      usuarioId,
      buffer: Buffer.from(`%PDF b ${sufijo}`),
      filename: 'b.pdf',
      mime: 'application/pdf',
      canal: 'WEB',
      loteId: lote.id,
    });
    const movs = await prisma.movimiento.findMany({ where: { loteId: lote.id } });
    expect(movs.map((m) => m.id).sort()).toEqual([a.movimientoId, b.movimientoId].sort());
  });

  it('un duplicado por archivo también queda en el lote (y el resumen lo refleja)', async () => {
    const lote = await prisma.loteIngesta.create({
      data: { empresaId, canal: 'WEB', creadoPorId: usuarioId, archivos: 1 },
    });
    const buffer = Buffer.from(`%PDF dup ${sufijo}`);
    await ingestarComprobante({
      empresaId, usuarioId, buffer, filename: 'c.pdf', mime: 'application/pdf', canal: 'WEB',
    });
    await ingestarComprobante({
      empresaId, usuarioId, buffer, filename: 'c.pdf', mime: 'application/pdf', canal: 'WEB', loteId: lote.id,
    });
    const movs = await prisma.movimiento.findMany({ where: { loteId: lote.id }, select: { estado: true, flags: true } });
    const r = resumirLote(movs);
    expect(r.total).toBe(1);
    expect(r.resultados).toEqual([{ clave: 'archivo-duplicado', cantidad: 1 }]);
  });
});
