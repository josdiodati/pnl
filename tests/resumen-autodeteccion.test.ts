import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { ingestarResumen, procesarExtraccionResumen } from '@/lib/resumenes/ingesta';

// Subida de resúmenes sin declarar tipo ni emisor: el PDF lo dice todo. Hasta
// que el worker extrae, el resumen se muestra con el nombre del archivo; la
// extracción pisa emisor y tipo con lo que declara el propio resumen.

describe('autodetección de tipo y emisor del resumen (integración)', () => {
  const sufijo = `autodet-${Date.now()}`;
  let empresaId: string;
  let usuarioId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Autodet', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Autodet SA', cuit: '30714325651' } });
    empresaId = empresa.id;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.job.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  const subir = (filename: string, contenido: string) =>
    ingestarResumen({
      empresaId,
      usuarioId,
      buffer: Buffer.from(`%PDF-1.4 ${contenido}`),
      filename,
      mime: 'application/pdf',
    });

  it('se sube sin declarar tipo ni emisor y queda con el nombre del archivo', async () => {
    const { resumenId } = await subir('Resumen Visa 07-26.pdf', `a-${sufijo}`);
    const resumen = await prisma.resumen.findUniqueOrThrow({ where: { id: resumenId } });
    expect(resumen.estado).toBe('PROCESANDO');
    expect(resumen.emisor).toBe('Resumen Visa 07-26');
    expect(await prisma.job.count({ where: { empresaId, tipo: 'EXTRACCION_RESUMEN' } })).toBe(1);
  });

  it('la extracción pisa el emisor y el tipo con lo que declara el PDF', async () => {
    const { resumenId } = await subir('scan_0001.pdf', `b-${sufijo}`);
    await procesarExtraccionResumen({ resumenId, empresaId });
    const resumen = await prisma.resumen.findUniqueOrThrow({ where: { id: resumenId } });
    expect(resumen.estado).toBe('EXTRAIDO');
    expect(resumen.emisor).toBe('Tarjeta Mock'); // el mock del extractor
    expect(resumen.tipo).toBe('TARJETA');
  });

  it('el mismo archivo dos veces se rechaza', async () => {
    await subir('otro.pdf', `c-${sufijo}`);
    await expect(subir('nombre-distinto.pdf', `c-${sufijo}`)).rejects.toThrow(/ya fue subido/i);
  });
});
