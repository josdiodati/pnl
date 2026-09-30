import { prisma } from '@/lib/db';
import { ingestarComprobante } from '@/lib/pipeline';
import { usuarioDeCasilla } from '@/lib/usuarios/casillas';

// Inbound email channel. The webhook (app/api/inbound-email) accepts a
// Postmark/SES-style JSON payload, authenticates it with INBOUND_EMAIL_SECRET,
// dedupes by MessageID and enqueues an EMAIL_IN job. The worker (this module)
// resolves the company from the destination address, requires the sender to
// be a mailbox of one of its users (who becomes the loader) and pushes every
// attachment into the shared ingestion pipeline.

export type EmailInPayload = {
  messageId: string;
  from: string | null;
  to: string; // comprobantes+{empresaSlug}@dominio
  adjuntos: { nombre: string; contentType: string; contenidoBase64: string }[];
};

/** Extracts the empresa slug from `comprobantes+{slug}@dominio`. */
export function slugDesdeDireccion(direccion: string): string | null {
  const match = direccion.toLowerCase().match(/comprobantes\+([a-z0-9-]+)@/);
  return match ? match[1] : null;
}

const MIMES_PERMITIDOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export async function procesarEmailEntrante(payload: EmailInPayload): Promise<void> {
  const slug = slugDesdeDireccion(payload.to);
  if (!slug) throw new Error(`Dirección destino sin slug de empresa: ${payload.to}`);
  const empresa = await prisma.empresa.findUnique({ where: { slug } });
  if (!empresa) throw new Error(`Empresa inexistente para el slug "${slug}"`);

  // Sólo se procesa lo que manda una casilla de un usuario de la empresa, y
  // queda cargado a su nombre (Configuración → Usuarios y roles → Casillas).
  const creadorId = await usuarioDeCasilla(empresa.id, payload.from);
  if (!creadorId) {
    console.log(`[email] mail ${payload.messageId} de ${payload.from ?? '(sin remitente)'} ignorado: no es casilla de ningún usuario de ${slug}`);
    return;
  }

  const adjuntos = payload.adjuntos.filter((adj) => MIMES_PERMITIDOS.has(adj.contentType));
  if (!adjuntos.length) return;

  // Un mail = un lote de ingesta (para el historial de /carga).
  const lote = await prisma.loteIngesta.create({
    data: {
      empresaId: empresa.id,
      canal: 'EMAIL',
      creadoPorId: creadorId,
      origenDetalle: payload.from || null,
      archivos: adjuntos.length,
    },
  });

  for (const adj of adjuntos) {
    await ingestarComprobante({
      empresaId: empresa.id,
      usuarioId: creadorId,
      buffer: Buffer.from(adj.contenidoBase64, 'base64'),
      filename: adj.nombre || 'adjunto.pdf',
      mime: adj.contentType,
      canal: 'EMAIL',
      loteId: lote.id,
    });
  }
}
