import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { ingestarComprobante, procesarExtraccion } from '@/lib/pipeline';
import { reprocesarComoComprobante } from '@/lib/carga/no-comprobante-service';
import type { ClasificadorDocumento } from '@/lib/extractor/clasificador';

// Capas 2 y 3 del filtro de no comprobantes, por el pipeline real con el
// extractor mock (EXTRACTOR_MODE=mock). El marcador PNL-MOCK fija lo que
// "lee" la extracción.

const sufijo = `nocomp-${Date.now()}`;
let empresaId = '';
let usuarioId = '';
let ctx: EmpresaContext;

const pdf = (datos: Record<string, unknown>, extra = '') =>
  Buffer.from(`%PDF-1.4 ${sufijo} ${extra} PNL-MOCK:${JSON.stringify({ tipoComprobante: null, total: null, esComprobanteFiscalArg: false, ...datos })}\n`);

async function cargar(buffer: Buffer, filename = 'doc.pdf') {
  const { movimientoId } = await ingestarComprobante({ empresaId, usuarioId, buffer, filename, mime: 'application/pdf', canal: 'EMAIL' });
  return movimientoId;
}
const clasificador = (r: Awaited<ReturnType<ClasificadorDocumento['clasificar']>> | Error): ClasificadorDocumento & { llamadas: number } => {
  const c = {
    llamadas: 0,
    async clasificar() { c.llamadas++; if (r instanceof Error) throw r; return r; },
  };
  return c;
};
const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test NoComp', passwordHash: 'x' } });
  usuarioId = usuario.id;
  const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'NoComp SA', cuit: '30714325651' } });
  empresaId = empresa.id;
  ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { empresaId } });
  await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
  await prisma.movimiento.deleteMany({ where: { empresaId } });
  await prisma.contraparte.deleteMany({ where: { empresaId } });
  await prisma.periodo.deleteMany({ where: { empresaId } });
  await prisma.auditLog.deleteMany({ where: { empresaId } });
  await prisma.empresa.delete({ where: { id: empresaId } });
  await prisma.usuario.delete({ where: { id: usuarioId } });
});

describe('pipeline: no comprobantes', () => {
  it('la extracción dice que es un presupuesto: queda NO_COMPROBANTE con el tipo y el motivo', async () => {
    const id = await cargar(pdf({ tipoDocumento: 'PRESUPUESTO', observaciones: 'Cotización válida 15 días' }, 'a'));
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: null });
    const m = await leer(id);
    expect(m.estado).toBe('NO_COMPROBANTE');
    expect(m.flags).toMatchObject({ tipoDocumento: 'PRESUPUESTO', noComprobantePor: 'EXTRACCION' });
  });

  it('el prefiltro seguro lo aparta SIN llamar a la extracción', async () => {
    // "error" en el nombre hace fallar al extractor mock si se lo llamara.
    const id = await cargar(pdf({}, 'b'), 'newsletter-error.pdf');
    const c = clasificador({ tipoDocumento: 'PUBLICIDAD', confianza: 0.97, motivo: 'Newsletter de ofertas', uso: null });
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: c });
    const m = await leer(id);
    expect(c.llamadas).toBe(1);
    expect(m.estado).toBe('NO_COMPROBANTE');
    expect(m.flags).toMatchObject({ tipoDocumento: 'PUBLICIDAD', motivoNoComprobante: 'Newsletter de ofertas', noComprobantePor: 'PREFILTRO' });
  });

  it('el prefiltro dudoso deja seguir a la extracción', async () => {
    const id = await cargar(pdf({ tipoComprobante: 'FACTURA_B', total: 100 }, 'c'));
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: clasificador({ tipoDocumento: 'OTRO', confianza: 0.5, motivo: '?', uso: null }) });
    expect((await leer(id)).estado).not.toBe('NO_COMPROBANTE');
  });

  it('si el prefiltro falla, sigue la extracción (no bloquea la carga)', async () => {
    const id = await cargar(pdf({ tipoComprobante: 'FACTURA_B', total: 100 }, 'd'));
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: clasificador(new Error('Resend 500')) });
    expect((await leer(id)).estado).not.toBe('NO_COMPROBANTE');
  });

  it('"es un comprobante": reprocesa sin prefiltro e ignorando la clasificación', async () => {
    const id = await cargar(pdf({ tipoDocumento: 'CONTRATO', tipoComprobante: 'FACTURA_B', total: 100 }, 'e'));
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: null });
    expect((await leer(id)).estado).toBe('NO_COMPROBANTE');

    await reprocesarComoComprobante(ctx, id);
    const m = await leer(id);
    expect(m.estado).toBe('PROCESANDO');
    expect(await prisma.job.count({ where: { empresaId, tipo: 'EXTRACCION', payload: { path: ['movimientoId'], equals: id } } })).toBeGreaterThanOrEqual(1);

    const c = clasificador({ tipoDocumento: 'CONTRATO', confianza: 0.99, motivo: 'x', uso: null });
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: c });
    expect(c.llamadas).toBe(0);
    expect((await leer(id)).estado).not.toBe('NO_COMPROBANTE');
  });

  it('sólo se reprocesa lo que está como NO_COMPROBANTE', async () => {
    const id = await cargar(pdf({ tipoComprobante: 'FACTURA_B', total: 100 }, 'f'));
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: null });
    await expect(reprocesarComoComprobante(ctx, id)).rejects.toThrow(/no es comprobante/i);
  });

  it('volver a subir el mismo archivo que quedó como no comprobante: se procesa como comprobante, no como duplicado', async () => {
    const buffer = pdf({ tipoDocumento: 'PRESUPUESTO', tipoComprobante: 'FACTURA_B', total: 100 }, 'g');
    const id = await cargar(buffer);
    await procesarExtraccion({ movimientoId: id, empresaId }, { clasificador: null });
    expect((await leer(id)).estado).toBe('NO_COMPROBANTE');

    const id2 = await cargar(buffer);
    const m2 = await leer(id2);
    expect(m2.estado).not.toBe('DUPLICADO');
    expect((m2.flags as any)?.forzarComprobante).toBe(true);
    await procesarExtraccion({ movimientoId: id2, empresaId }, { clasificador: null });
    expect((await leer(id2)).estado).not.toBe('NO_COMPROBANTE');
  });
});
