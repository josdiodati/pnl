import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { slugDesdeDireccion, type EmailInPayload } from '@/lib/canales/email';
import { registrarEventoUnico, yaRegistrado } from '@/lib/canales/telegram';
import * as resend from '@/lib/canales/resend';

// Facturas por mail vía Resend, por POLLING (Cloudflare Access no deja
// entrar webhooks a pnl.ledger.ar). El worker llama a sincronizarRecibidos
// una vez por minuto: por cada mail nuevo a comprobantes+{slug}@dominio baja
// los adjuntos y encola el mismo EMAIL_IN que usa el webhook de email.

const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ADJUNTOS = 10;

type Deps = Pick<typeof resend, 'listarRecibidos' | 'listarAdjuntos' | 'descargarAdjunto'>;

export async function sincronizarRecibidos(deps: Partial<Deps> = {}): Promise<{ encolados: number; ignorados: number }> {
  const d: Deps = { listarRecibidos: resend.listarRecibidos, listarAdjuntos: resend.listarAdjuntos, descargarAdjunto: resend.descargarAdjunto, ...deps };
  let encolados = 0;
  let ignorados = 0;
  // La lista viene del más nuevo al más viejo; se procesa en orden de llegada.
  for (const m of [...(await d.listarRecibidos())].reverse()) {
    if (await yaRegistrado('RESEND', m.id)) continue;
    const ignorar = async (motivo: string) => {
      console.log(`[resend] mail ${m.id} de ${m.from} a ${m.to.join(',')} ignorado: ${motivo}`);
      await registrarEventoUnico('RESEND', m.id);
      ignorados++;
    };
    const destino = m.to.find((t) => slugDesdeDireccion(t));
    const slug = destino ? slugDesdeDireccion(destino) : null;
    const empresa = slug ? await prisma.empresa.findUnique({ where: { slug } }) : null;
    if (!empresa) { await ignorar(slug ? `empresa inexistente "${slug}"` : 'dirección sin comprobantes+{empresa}'); continue; }

    const utiles = (await d.listarAdjuntos(m.id))
      .filter((a) => a.content_disposition !== 'inline' && MIMES.has(a.content_type) && a.size <= MAX_BYTES)
      .slice(0, MAX_ADJUNTOS);
    if (!utiles.length) { await ignorar('sin adjuntos PDF/imagen'); continue; }

    try {
      const adjuntos = [];
      for (const a of utiles) {
        const buf = await d.descargarAdjunto(a.download_url);
        adjuntos.push({ nombre: a.filename || 'adjunto.pdf', contentType: a.content_type, contenidoBase64: buf.toString('base64') });
      }
      const payload: EmailInPayload = { messageId: `resend:${m.id}`, from: m.from, to: destino!, adjuntos };
      await enqueueJob('EMAIL_IN', payload as never, empresa.id);
      await registrarEventoUnico('RESEND', m.id);
      encolados++;
    } catch (err) {
      // No se marca como visto: se reintenta en la próxima pasada.
      console.error(`[resend] mail ${m.id}: no se pudieron bajar los adjuntos:`, err instanceof Error ? err.message : err);
    }
  }
  return { encolados, ignorados };
}
