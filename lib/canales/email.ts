import { prisma } from '@/lib/db';
import { ingestarComprobante, resolverCreadorCanal } from '@/lib/pipeline';

// Inbound email channel. The webhook (app/api/inbound-email) accepts a
// Postmark/SES-style JSON payload, authenticates it with INBOUND_EMAIL_SECRET,
// dedupes by MessageID and enqueues an EMAIL_IN job. The worker (this module)
// resolves the company from the destination address and pushes every
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

  const creadorId = await resolverCreadorCanal(empresa.id, payload.from);
  if (!creadorId) throw new Error(`La empresa ${slug} no tiene usuarios para asignar como cargador`);

  for (const adj of payload.adjuntos) {
    if (!MIMES_PERMITIDOS.has(adj.contentType)) continue; // skip signatures, etc.
    await ingestarComprobante({
      empresaId: empresa.id,
      usuarioId: creadorId,
      buffer: Buffer.from(adj.contenidoBase64, 'base64'),
      filename: adj.nombre || 'adjunto.pdf',
      mime: adj.contentType,
      canal: 'EMAIL',
    });
  }
}
