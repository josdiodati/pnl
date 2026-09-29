import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { slugDesdeDireccion, type EmailInPayload } from '@/lib/canales/email';
import { registrarEventoUnico, yaRegistrado } from '@/lib/canales/eventos';
import * as resend from '@/lib/canales/resend';
import type { AdjuntoResend } from '@/lib/canales/resend';

// Facturas por mail vía Resend, por POLLING (Cloudflare Access no deja
// entrar webhooks a pnl.ledger.ar). El worker llama a sincronizarRecibidos
// una vez por minuto: recorre la bandeja hacia atrás mientras los mails sean
// de los últimos VENTANA_DIAS y, por cada uno no visto dirigido a
// comprobantes+{slug}@dominio, baja los adjuntos y encola el mismo EMAIL_IN
// que usa el webhook de email. Un mail que falla (429, descarga) no se marca
// como visto: se reintenta en las pasadas siguientes dentro de la ventana.

const VENTANA_DIAS = 3;
const MAX_PAGINAS = 20;
const MAX_ADJUNTOS = 10;
const MAX_BYTES_ADJUNTO = 15 * 1024 * 1024;
const MAX_BYTES_MAIL = 25 * 1024 * 1024;
const PAUSA_MS = 300; // entre llamadas a la API (Resend limita ~2 pedidos/s)
// Filtro de basura típica de los mails (capa 1 contra los no comprobantes): una
// foto de un ticket pesa bastante más de 20 KB; un logo o un ícono, menos.
const MIN_BYTES_IMAGEN = 20 * 1024;
const MAX_BYTES_IMAGEN_DE_FIRMA = 100 * 1024;
const NOMBRE_IMAGEN_DE_FIRMA = /^(image\d{3}|outlook-|logo|firma|signature|banner|icon)/i;

const MIME_POR_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
const MIMES = new Set(Object.values(MIME_POR_EXTENSION));

type Deps = Pick<typeof resend, 'listarRecibidos' | 'listarAdjuntos' | 'descargarAdjunto'> & { pausaMs: number };

const dormir = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** "Juan Pérez <Juan@X.com>" -> "juan@x.com" (para reconocer al usuario que manda). */
export function direccionDe(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/**
 * El tipo real del adjunto: muchos clientes mandan el PDF como
 * application/octet-stream; ahí manda la extensión. Null si no sirve.
 */
function tipoUtil(a: AdjuntoResend): string | null {
  const ext = a.filename?.toLowerCase().split('.').pop() ?? '';
  const tipo = MIMES.has(a.content_type) ? a.content_type : MIME_POR_EXTENSION[ext] ?? null;
  if (!tipo) return null;
  if (tipo !== 'application/pdf') {
    // Imágenes inline = logos y firmas del cuerpo; un PDF inline (Apple Mail) sí es un adjunto.
    if (a.content_disposition === 'inline') return null;
    // Imágenes chicas, y las livianas cuyo nombre es de firma (image001.png, logo…).
    // Una foto de verdad pesa mucho más aunque el celular la llame image000001.jpg.
    if (a.size < MIN_BYTES_IMAGEN) return null;
    if (a.size < MAX_BYTES_IMAGEN_DE_FIRMA && NOMBRE_IMAGEN_DE_FIRMA.test(a.filename ?? '')) return null;
  }
  return tipo;
}

function seleccionarAdjuntos(adjuntos: AdjuntoResend[], emailId: string): { a: AdjuntoResend; tipo: string }[] {
  const elegidos: { a: AdjuntoResend; tipo: string }[] = [];
  let total = 0;
  for (const a of adjuntos) {
    const tipo = tipoUtil(a);
    if (!tipo || a.size > MAX_BYTES_ADJUNTO || total + a.size > MAX_BYTES_MAIL) {
      console.log(`[resend] mail ${emailId}: se descarta el adjunto "${a.filename}" (${a.content_type}, ${a.size} bytes)`);
      continue;
    }
    elegidos.push({ a, tipo });
    total += a.size;
    if (elegidos.length === MAX_ADJUNTOS) break;
  }
  return elegidos;
}

export async function sincronizarRecibidos(deps: Partial<Deps> = {}): Promise<{ encolados: number; ignorados: number }> {
  const d: Deps = {
    listarRecibidos: resend.listarRecibidos,
    listarAdjuntos: resend.listarAdjuntos,
    descargarAdjunto: resend.descargarAdjunto,
    pausaMs: PAUSA_MS,
    ...deps,
  };
  const limite = Date.now() - VENTANA_DIAS * 86_400_000;

  // 1. Mails no vistos dentro de la ventana (la API devuelve del más nuevo al más viejo).
  const nuevos: resend.RecibidoResend[] = [];
  let after: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (pagina > 0) await dormir(d.pausaMs);
    const { data, hasMore } = await d.listarRecibidos(after);
    let fueraDeVentana = false;
    for (const m of data) {
      if (new Date(m.created_at).getTime() < limite) { fueraDeVentana = true; break; }
      if (!(await yaRegistrado('RESEND', m.id))) nuevos.push(m);
    }
    if (fueraDeVentana || !hasMore || !data.length) break;
    after = data[data.length - 1].id;
  }

  // 2. Se procesan en orden de llegada.
  let encolados = 0;
  let ignorados = 0;
  for (const m of nuevos.reverse()) {
    const ignorar = async (motivo: string) => {
      console.log(`[resend] mail ${m.id} de ${m.from} a ${m.to.join(',')} ignorado: ${motivo}`);
      await registrarEventoUnico('RESEND', m.id);
      ignorados++;
    };
    const destino = m.to.find((t) => slugDesdeDireccion(t));
    const slug = destino ? slugDesdeDireccion(destino) : null;
    const empresa = slug ? await prisma.empresa.findUnique({ where: { slug } }) : null;
    if (!empresa) { await ignorar(slug ? `empresa inexistente "${slug}"` : 'dirección sin comprobantes+{empresa}'); continue; }

    try {
      await dormir(d.pausaMs);
      const utiles = seleccionarAdjuntos(await d.listarAdjuntos(m.id), m.id);
      if (!utiles.length) { await ignorar('sin adjuntos PDF/imagen'); continue; }
      const adjuntos = [];
      for (const { a, tipo } of utiles) {
        const buf = await d.descargarAdjunto(a.download_url);
        adjuntos.push({ nombre: a.filename || 'adjunto.pdf', contentType: tipo, contenidoBase64: buf.toString('base64') });
      }
      const payload: EmailInPayload = { messageId: `resend:${m.id}`, from: direccionDe(m.from), to: destino!, adjuntos };
      await enqueueJob('EMAIL_IN', payload as never, empresa.id);
      await registrarEventoUnico('RESEND', m.id);
      encolados++;
    } catch (err) {
      // No se marca como visto: se reintenta en la próxima pasada.
      console.error(`[resend] mail ${m.id}: no se pudo procesar:`, err instanceof Error ? err.message : err);
    }
  }
  return { encolados, ignorados };
}
