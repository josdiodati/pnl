import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { sincronizarRecibidos } from '@/lib/canales/resend-entrante';
import type { RecibidoResend, AdjuntoResend } from '@/lib/canales/resend';

const mail = (id: string, to: string): RecibidoResend => ({ id, from: 'proveedor@x.com', to: [to], subject: 'Factura', created_at: '2026-09-29T12:00:00Z' });
const pdf = (id: string, extra: Partial<AdjuntoResend> = {}): AdjuntoResend =>
  ({ id, filename: `${id}.pdf`, content_type: 'application/pdf', content_disposition: 'attachment', size: 1000, download_url: `https://cdn/${id}`, ...extra });

function deps(recibidos: RecibidoResend[], adjuntos: Record<string, AdjuntoResend[]>, opts: { fallaDescarga?: boolean } = {}) {
  return {
    listarRecibidos: async () => recibidos,
    listarAdjuntos: async (id: string) => adjuntos[id] ?? [],
    descargarAdjunto: async () => { if (opts.fallaDescarga) throw new Error('Resend adjunto 500'); return Buffer.from('%PDF-1.4'); },
  };
}

const ids = ['rs-1', 'rs-2', 'rs-3', 'rs-4', 'rs-5'];
const slug = `rs${Date.now()}`;
let empresaId = '';
beforeAll(async () => {
  empresaId = (await prisma.empresa.create({ data: { slug, razonSocial: 'Resend SA', cuit: '30714325651' } })).id;
});
beforeEach(async () => {
  await prisma.eventoWebhook.deleteMany({ where: { canal: 'RESEND', claveExterna: { in: ids } } });
  await prisma.job.deleteMany({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], string_starts_with: 'resend:rs-' } } });
});
afterAll(async () => {
  await prisma.eventoWebhook.deleteMany({ where: { canal: 'RESEND', claveExterna: { in: ids } } });
  await prisma.job.deleteMany({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], string_starts_with: 'resend:rs-' } } });
  await prisma.empresa.delete({ where: { id: empresaId } });
});

describe('sincronizarRecibidos', () => {
  it('encola un EMAIL_IN con los adjuntos en base64 para la empresa del slug', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-1', `Comprobantes+${slug.toUpperCase()}@ledger.ar`)], { 'rs-1': [pdf('a1')] }));
    expect(r).toEqual({ encolados: 1, ignorados: 0 });
    const job = await prisma.job.findFirstOrThrow({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], equals: 'resend:rs-1' } } });
    const p = job.payload as any;
    expect(p.adjuntos).toEqual([{ nombre: 'a1.pdf', contentType: 'application/pdf', contenidoBase64: Buffer.from('%PDF-1.4').toString('base64') }]);
  });

  it('el mismo mail en dos pasadas se encola una sola vez', async () => {
    const d = deps([mail('rs-2', `comprobantes+${slug}@ledger.ar`)], { 'rs-2': [pdf('a2')] });
    await sincronizarRecibidos(d);
    const r = await sincronizarRecibidos(d);
    expect(r).toEqual({ encolados: 0, ignorados: 0 });
  });

  it('dirección sin slug o empresa inexistente: se ignora y queda como visto', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-3', 'hola@ledger.ar'), mail('rs-4', 'comprobantes+nadie@ledger.ar')], {}));
    expect(r).toEqual({ encolados: 0, ignorados: 2 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: { in: ['rs-3', 'rs-4'] } } })).toBe(2);
  });

  it('descarta adjuntos inline, no permitidos o de más de 15 MB; sin adjuntos útiles se ignora', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-5', `comprobantes+${slug}@ledger.ar`)], {
      'rs-5': [pdf('firma', { content_type: 'image/png', content_disposition: 'inline' }), pdf('zip', { content_type: 'application/zip' }), pdf('grande', { size: 16 * 1024 * 1024 })],
    }));
    expect(r).toEqual({ encolados: 0, ignorados: 1 });
  });

  it('si falla la descarga no marca el mail como visto (se reintenta)', async () => {
    await expect(sincronizarRecibidos(deps([mail('rs-1', `comprobantes+${slug}@ledger.ar`)], { 'rs-1': [pdf('a1')] }, { fallaDescarga: true })))
      .resolves.toEqual({ encolados: 0, ignorados: 0 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: 'rs-1' } })).toBe(0);
  });
});
