import { describe, it, expect, afterEach } from 'vitest';
import { enviarEmail, listarRecibidos, listarAdjuntos, resendHabilitado } from '@/lib/canales/resend';

const llamadas: { url: string; init?: RequestInit }[] = [];
const fakeFetch = (respuesta: unknown, status = 200) =>
  (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuesta), { status });
  }) as unknown as typeof fetch;

afterEach(() => { llamadas.length = 0; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_REMITENTE; });

describe('cliente Resend', () => {
  it('sin key está deshabilitado', () => {
    expect(resendHabilitado()).toBe(false);
  });

  it('enviarEmail usa el remitente por defecto y la key como Bearer', async () => {
    process.env.RESEND_API_KEY = 're_test';
    await enviarEmail({ to: ['a@b.com'], subject: 'Hola', text: 'cuerpo' }, fakeFetch({ id: 'x' }));
    expect(llamadas[0].url).toBe('https://api.resend.com/emails');
    expect((llamadas[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(llamadas[0].init!.body))).toEqual({
      from: 'P&L Manager <avisos@ledger.ar>', to: ['a@b.com'], subject: 'Hola', text: 'cuerpo',
    });
  });

  it('enviarEmail lanza con el mensaje de Resend si falla', async () => {
    process.env.RESEND_API_KEY = 're_test';
    await expect(enviarEmail({ to: ['a@b.com'], subject: 's', text: 't' }, fakeFetch({ name: 'validation_error', message: 'bad from' }, 422)))
      .rejects.toThrow(/422.*bad from/);
  });

  it('listarRecibidos y listarAdjuntos devuelven data', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const r = await listarRecibidos(undefined, fakeFetch({ object: 'list', has_more: true, data: [{ id: 'm1', from: 'p@x.com', to: ['comprobantes+kawellu@ledger.ar'], subject: 'F', created_at: '2026-09-29T12:00:00Z' }] }));
    expect(llamadas[0].url).toBe('https://api.resend.com/emails/receiving?limit=100');
    expect(r).toMatchObject({ hasMore: true, data: [{ id: 'm1' }] });
    await listarRecibidos('m1', fakeFetch({ object: 'list', has_more: false, data: [] }));
    expect(llamadas[1].url).toBe('https://api.resend.com/emails/receiving?limit=100&after=m1');
    const a = await listarAdjuntos('m1', fakeFetch({ object: 'list', data: [{ id: 'a1', filename: 'f.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: 10, download_url: 'https://inbound-cdn.resend.com/x' }] }));
    expect(llamadas[2].url).toBe('https://api.resend.com/emails/receiving/m1/attachments');
    expect(a[0].filename).toBe('f.pdf');
  });
});
