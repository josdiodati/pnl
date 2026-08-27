import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { eliminarDuplicado, eliminarDuplicados, originalDeDuplicado } from '@/lib/movimientos/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Borrado físico de DUPLICADOS: única excepción al "nada se borra". El original
// queda intacto; sólo se borra lo que está en estado DUPLICADO.

describe('originalDeDuplicado', () => {
  it('lee el original de ambos caminos (hash de archivo / QR-ARCA)', () => {
    expect(originalDeDuplicado({ duplicadoArchivo: 'a1' })).toBe('a1');
    expect(originalDeDuplicado({ duplicados: ['b1', 'b2'] })).toBe('b1');
    expect(originalDeDuplicado(null)).toBeNull();
    expect(originalDeDuplicado({})).toBeNull();
  });
});

describe('eliminar duplicados (integración)', () => {
  const sufijo = `del-dup-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let otraEmpresaId: string;
  let usuarioId: string;
  let centroId: string;

  const mov = async (empresa: string, estado: string, flags: object | null = null) =>
    prisma.movimiento.create({
      data: { empresaId: empresa, origen: 'COMPROBANTE', estado: estado as never, total: 100, creadoPorId: usuarioId, flags: flags as never, archivoNombre: 'f.pdf' },
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Del Dup', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'DelDup SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    otraEmpresaId = (await prisma.empresa.create({ data: { slug: `${sufijo}-b`, razonSocial: 'Otra SA', cuit: '30714325651' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'CC', tipo: 'SOPORTE' } })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    for (const e of [empresaId, otraEmpresaId]) {
      await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId: e } } });
      await prisma.movimiento.deleteMany({ where: { empresaId: e } });
      await prisma.loteIngesta.deleteMany({ where: { empresaId: e } });
      await prisma.centroCosto.deleteMany({ where: { empresaId: e } });
      await prisma.auditLog.deleteMany({ where: { empresaId: e } });
      await prisma.empresa.delete({ where: { id: e } });
    }
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('borra un DUPLICADO con sus líneas, descuenta el archivo del lote y deja el original intacto', async () => {
    const original = await mov(empresaId, 'ASIGNADO');
    const lote = await prisma.loteIngesta.create({ data: { empresaId, canal: 'WEB', archivos: 2 } });
    const dup = await mov(empresaId, 'DUPLICADO', { duplicadoArchivo: original.id });
    await prisma.movimiento.update({ where: { id: dup.id }, data: { loteId: lote.id } });
    await prisma.movimientoLinea.create({ data: { movimientoId: dup.id, centroCostoId: centroId, porcentaje: 100 } });

    await eliminarDuplicado(ctx, dup.id);

    expect(await prisma.movimiento.findUnique({ where: { id: dup.id } })).toBeNull();
    expect(await prisma.movimientoLinea.count({ where: { movimientoId: dup.id } })).toBe(0);
    expect((await prisma.movimiento.findUnique({ where: { id: original.id } }))!.estado).toBe('ASIGNADO');
    const audit = await prisma.auditLog.findFirst({ where: { empresaId, entidadId: dup.id, accion: 'ELIMINAR_DUPLICADO' } });
    expect(audit).not.toBeNull();
    expect((audit!.antes as { original?: string }).original).toBe(original.id);
    expect((await prisma.loteIngesta.findUnique({ where: { id: lote.id } }))!.archivos).toBe(1);
  });

  it('no borra nada que no sea DUPLICADO', async () => {
    const pend = await mov(empresaId, 'PENDIENTE_VALIDACION');
    await expect(eliminarDuplicado(ctx, pend.id)).rejects.toThrow(DomainError);
    expect(await prisma.movimiento.findUnique({ where: { id: pend.id } })).not.toBeNull();
  });

  it('no alcanza a duplicados de otra empresa', async () => {
    const ajeno = await mov(otraEmpresaId, 'DUPLICADO');
    await expect(eliminarDuplicado(ctx, ajeno.id)).rejects.toThrow(DomainError);
    expect(await prisma.movimiento.findUnique({ where: { id: ajeno.id } })).not.toBeNull();
  });

  it('borrado masivo: sólo los DUPLICADO de la empresa', async () => {
    await mov(empresaId, 'DUPLICADO', { duplicados: ['x'] });
    await mov(empresaId, 'DUPLICADO');
    const n = await eliminarDuplicados(ctx);
    expect(n).toBe(2);
    expect(await prisma.movimiento.count({ where: { empresaId, estado: 'DUPLICADO' } })).toBe(0);
    expect(await prisma.movimiento.count({ where: { empresaId: otraEmpresaId, estado: 'DUPLICADO' } })).toBe(1);
  });
});

describe('formatFechaHora', () => {
  it('muestra hora de Buenos Aires en 24 h sin depender del TZ del server', async () => {
    const { formatFechaHora } = await import('@/lib/format');
    expect(formatFechaHora(new Date('2026-08-27T19:01:38Z'))).toBe('27/08/2026, 16:01');
  });
});
