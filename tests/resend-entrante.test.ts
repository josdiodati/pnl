import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { sincronizarRecibidos } from '@/lib/canales/resend-entrante';
import type { RecibidoResend, AdjuntoResend } from '@/lib/canales/resend';

const slug = `rs${Date.now()}`;
const REMITENTE = `carga-${slug}@gmail.com`; // casilla asociada a un usuario de la empresa
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
const mail = (id: string, to: string, from = REMITENTE, creado = hace(0)): RecibidoResend => ({ id, from, to: [to], subject: 'Factura', created_at: creado });
const pdf = (id: string, extra: Partial<AdjuntoResend> = {}): AdjuntoResend =>
  ({ id, filename: `${id}.pdf`, content_type: 'application/pdf', content_disposition: 'attachment', size: 1000, download_url: `https://cdn/${id}`, ...extra });

/**
 * `recibidos` es la bandeja completa del más nuevo al más viejo; se sirve en
 * páginas de `porPagina` como la API (cursor `after` = id del último de la página).
 */
function deps(
  recibidos: RecibidoResend[],
  adjuntos: Record<string, AdjuntoResend[]>,
  opts: {
    fallaDescarga?: boolean; fallaAdjuntos?: string[]; porPagina?: number; paginasPedidas?: string[];
    autenticacion?: Record<string, string> | null; adjuntosPedidos?: string[];
  } = {},
) {
  const porPagina = opts.porPagina ?? 100;
  return {
    pausaMs: 0,
    obtenerRecibido: async () => ({
      authentication: opts.autenticacion === undefined ? { spf: 'pass', dkim: 'pass', dmarc: 'pass' } : opts.autenticacion,
    }),
    listarRecibidos: async (after?: string) => {
      opts.paginasPedidas?.push(after ?? '(primera)');
      const desde = after ? recibidos.findIndex((m) => m.id === after) + 1 : 0;
      const data = recibidos.slice(desde, desde + porPagina);
      return { data, hasMore: desde + porPagina < recibidos.length };
    },
    listarAdjuntos: async (id: string) => {
      opts.adjuntosPedidos?.push(id);
      if (opts.fallaAdjuntos?.includes(id)) throw new Error('Resend 429: Too many requests');
      return adjuntos[id] ?? [];
    },
    descargarAdjunto: async () => { if (opts.fallaDescarga) throw new Error('Resend adjunto 500'); return Buffer.from('%PDF-1.4'); },
  };
}

const ids = Array.from({ length: 20 }, (_, i) => `rs-${i + 1}`);
const para = () => `comprobantes+${slug}@ledger.ar`;
let empresaId = '';
let usuarioId = '';
const jobDe = (id: string) => prisma.job.findFirst({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], equals: `resend:${id}` } } });

async function limpiar() {
  await prisma.eventoWebhook.deleteMany({ where: { canal: 'RESEND', claveExterna: { in: ids } } });
  await prisma.job.deleteMany({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], string_starts_with: 'resend:rs-' } } });
}
beforeAll(async () => {
  usuarioId = (await prisma.usuario.create({ data: { email: `login-${slug}@test.local`, nombre: 'Carga', passwordHash: 'x' } })).id;
  await prisma.casillaUsuario.createMany({ data: [{ usuarioId, email: REMITENTE }, { usuarioId, email: `juan-${slug}@proveedor.com` }] });
  empresaId = (await prisma.empresa.create({
    data: { slug, razonSocial: 'Resend SA', cuit: '30714325651', usuarios: { create: [{ usuarioId, rol: 'CARGADOR' }] } },
  })).id;
});
beforeEach(limpiar);
afterAll(async () => {
  await limpiar();
  await prisma.usuarioEmpresa.deleteMany({ where: { empresaId } });
  await prisma.empresa.delete({ where: { id: empresaId } });
  await prisma.usuario.delete({ where: { id: usuarioId } }); // casillas en cascada
});

describe('sincronizarRecibidos', () => {
  it('encola un EMAIL_IN con los adjuntos en base64 para la empresa del slug', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-1', `Comprobantes+${slug.toUpperCase()}@ledger.ar`)], { 'rs-1': [pdf('a1')] }));
    expect(r).toEqual({ encolados: 1, ignorados: 0 });
    const p = (await jobDe('rs-1'))!.payload as any;
    expect(p.adjuntos).toEqual([{ nombre: 'a1.pdf', contentType: 'application/pdf', contenidoBase64: Buffer.from('%PDF-1.4').toString('base64') }]);
  });

  it('el mismo mail en dos pasadas se encola una sola vez', async () => {
    const d = deps([mail('rs-2', para())], { 'rs-2': [pdf('a2')] });
    await sincronizarRecibidos(d);
    expect(await sincronizarRecibidos(d)).toEqual({ encolados: 0, ignorados: 0 });
  });

  it('dirección sin slug o empresa inexistente: se ignora y queda como visto', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-3', 'hola@ledger.ar'), mail('rs-4', 'comprobantes+nadie@ledger.ar')], {}));
    expect(r).toEqual({ encolados: 0, ignorados: 2 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: { in: ['rs-3', 'rs-4'] } } })).toBe(2);
  });

  it('descarta imágenes inline (firmas), tipos no permitidos y archivos de más de 15 MB', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-5', para())], {
      'rs-5': [pdf('firma', { filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline' }), pdf('zip', { filename: 'x.zip', content_type: 'application/zip' }), pdf('grande', { size: 16 * 1024 * 1024 })],
    }));
    expect(r).toEqual({ encolados: 0, ignorados: 1 });
  });

  it('acepta un PDF inline (Apple Mail) y uno como octet-stream reconocido por la extensión', async () => {
    await sincronizarRecibidos(deps([mail('rs-6', para())], {
      'rs-6': [pdf('inline', { content_disposition: 'inline' }), pdf('octeto', { content_type: 'application/octet-stream' })],
    }));
    const p = (await jobDe('rs-6'))!.payload as any;
    expect(p.adjuntos.map((a: any) => [a.nombre, a.contentType])).toEqual([['inline.pdf', 'application/pdf'], ['octeto.pdf', 'application/pdf']]);
  });

  it('descarta imágenes chicas y las de firma (nombre típico y liviana), pero no fotos grandes ni PDFs chicos', async () => {
    await sincronizarRecibidos(deps([mail('rs-11', para())], {
      'rs-11': [
        pdf('image001', { filename: 'image001.png', content_type: 'image/png', size: 60_000 }),
        pdf('fotoiphone', { filename: 'image000001.jpg', content_type: 'image/jpeg', size: 2_500_000 }),
        pdf('logo', { filename: 'logo-empresa.jpg', content_type: 'image/jpeg', size: 90_000 }),
        pdf('mini', { filename: 'foto.png', content_type: 'image/png', size: 15_000 }),
        pdf('ticket', { filename: 'ticket-cafe.jpg', content_type: 'image/jpeg', size: 180_000 }),
        pdf('chico', { size: 9_000 }),
      ],
    }));
    const nombres = ((await jobDe('rs-11'))!.payload as any).adjuntos.map((a: any) => a.nombre);
    expect(nombres).toEqual(['image000001.jpg', 'ticket-cafe.jpg', 'chico.pdf']);
  });

  it('corta en 25 MB por mail', async () => {
    const mb10 = 10 * 1024 * 1024;
    await sincronizarRecibidos(deps([mail('rs-7', para())], { 'rs-7': [pdf('p1', { size: mb10 }), pdf('p2', { size: mb10 }), pdf('p3', { size: mb10 })] }));
    expect(((await jobDe('rs-7'))!.payload as any).adjuntos).toHaveLength(2);
  });

  it('guarda sólo la dirección del remitente, sin el nombre', async () => {
    await sincronizarRecibidos(deps([mail('rs-8', para(), `Juan Pérez <Juan-${slug}@Proveedor.com>`)], { 'rs-8': [pdf('a8')] }));
    expect(((await jobDe('rs-8'))!.payload as any).from).toBe(`juan-${slug}@proveedor.com`);
  });

  it('si falla la descarga no marca el mail como visto (se reintenta)', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-1', para())], { 'rs-1': [pdf('a1')] }, { fallaDescarga: true }));
    expect(r).toEqual({ encolados: 0, ignorados: 0 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: 'rs-1' } })).toBe(0);
  });

  it('un 429 al listar los adjuntos de un mail no frena a los demás, y se reintenta en la pasada siguiente', async () => {
    const bandeja = [mail('rs-10', para()), mail('rs-9', para())];
    const adj = { 'rs-9': [pdf('a9')], 'rs-10': [pdf('a10')] };
    expect(await sincronizarRecibidos(deps(bandeja, adj, { fallaAdjuntos: ['rs-9'] }))).toEqual({ encolados: 1, ignorados: 0 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: 'rs-9' } })).toBe(0);
    // rs-9 es más viejo que rs-10 (ya visto): igual se reintenta.
    expect(await sincronizarRecibidos(deps(bandeja, adj))).toEqual({ encolados: 1, ignorados: 0 });
    expect(await jobDe('rs-9')).not.toBeNull();
  });

  it('pagina hacia atrás mientras los mails sean de los últimos 3 días', async () => {
    await sincronizarRecibidos(deps([mail('rs-2', para())], { 'rs-2': [pdf('a2')] }));
    const paginas: string[] = [];
    const bandeja = [mail('rs-12', para()), mail('rs-11', para()), mail('rs-2', para()), mail('rs-1', para(), 'p@x.com', hace(5))];
    const r = await sincronizarRecibidos(deps(bandeja, { 'rs-12': [pdf('b')], 'rs-11': [pdf('c')], 'rs-1': [pdf('d')] }, { porPagina: 1, paginasPedidas: paginas }));
    expect(r).toEqual({ encolados: 2, ignorados: 0 });
    expect(paginas).toEqual(['(primera)', 'rs-12', 'rs-11', 'rs-2']);
    expect(await jobDe('rs-1')).toBeNull();
  });

  it('un remitente que no es casilla de un usuario de la empresa se ignora sin bajar nada', async () => {
    const pedidos: string[] = [];
    const r = await sincronizarRecibidos(deps([mail('rs-13', para(), 'proveedor@desconocido.com')], { 'rs-13': [pdf('x')] }, { adjuntosPedidos: pedidos }));
    expect(r).toEqual({ encolados: 0, ignorados: 1 });
    expect(pedidos).toEqual([]);
  });

  it('DMARC distinto de pass (remitente posiblemente falsificado) o sin dato: se ignora', async () => {
    const r1 = await sincronizarRecibidos(deps([mail('rs-14', para())], { 'rs-14': [pdf('x')] }, { autenticacion: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }));
    const r2 = await sincronizarRecibidos(deps([mail('rs-15', para())], { 'rs-15': [pdf('x')] }, { autenticacion: null }));
    expect([r1, r2]).toEqual([{ encolados: 0, ignorados: 1 }, { encolados: 0, ignorados: 1 }]);
  });

  it('con EMAIL_EXIGIR_DMARC=off alcanza con que el remitente sea una casilla asociada', async () => {
    process.env.EMAIL_EXIGIR_DMARC = 'off';
    try {
      const r = await sincronizarRecibidos(deps([mail('rs-16', para())], { 'rs-16': [pdf('x')] }, { autenticacion: { dmarc: 'none' } }));
      expect(r).toEqual({ encolados: 1, ignorados: 0 });
    } finally {
      delete process.env.EMAIL_EXIGIR_DMARC;
    }
  });
});
