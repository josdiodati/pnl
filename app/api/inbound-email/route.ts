import { NextRequest, NextResponse } from 'next/server';
import { enqueueJob } from '@/lib/jobs';
import { slugDesdeDireccion, type EmailInPayload } from '@/lib/canales/email';
import { registrarEventoUnico } from '@/lib/canales/telegram';
import { prisma } from '@/lib/db';

// Inbound email webhook (Postmark/SES-style JSON). Protected by
// INBOUND_EMAIL_SECRET (header X-Inbound-Secret or ?secret=). The company is
// resolved from the destination address comprobantes+{slug}@dominio. Replays
// are deduped by MessageID. Without a provider configured you can exercise it
// with a sample payload (see README) — that IS the documented mock mode.
export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Canal de email deshabilitado: configurá INBOUND_EMAIL_SECRET para habilitarlo.' },
      { status: 503 },
    );
  }
  const provisto = req.headers.get('x-inbound-secret') ?? req.nextUrl.searchParams.get('secret');
  if (provisto !== secret) return NextResponse.json({ error: 'Secret inválido' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Postmark style: { MessageID, From, To/ToFull, Attachments: [{Name, Content, ContentType}] }
  const messageId = String(body.MessageID ?? body.messageId ?? '');
  const to = String(
    body.To ?? body.to ?? (Array.isArray(body.ToFull) ? body.ToFull.map((t: any) => t.Email).join(',') : ''),
  );
  const from = String(body.From ?? body.from ?? '') || null;
  const adjuntosRaw: any[] = body.Attachments ?? body.attachments ?? [];

  if (!messageId) return NextResponse.json({ error: 'Falta MessageID' }, { status: 400 });

  const slug = to
    .split(',')
    .map((d) => slugDesdeDireccion(d.trim()))
    .find(Boolean);
  if (!slug) {
    return NextResponse.json({ error: 'Ninguna dirección destino con formato comprobantes+{empresa}@dominio' }, { status: 422 });
  }
  const empresa = await prisma.empresa.findUnique({ where: { slug } });
  if (!empresa) return NextResponse.json({ error: `Empresa desconocida: ${slug}` }, { status: 422 });

  // Idempotency: providers retry on timeouts
  const primeraVez = await registrarEventoUnico('EMAIL', messageId);
  if (!primeraVez) return NextResponse.json({ ok: true, duplicado: true });

  const payload: EmailInPayload = {
    messageId,
    from,
    to,
    adjuntos: adjuntosRaw
      .filter((a) => a?.Content ?? a?.contenidoBase64)
      .map((a) => ({
        nombre: String(a.Name ?? a.nombre ?? 'adjunto.pdf'),
        contentType: String(a.ContentType ?? a.contentType ?? 'application/pdf'),
        contenidoBase64: String(a.Content ?? a.contenidoBase64),
      })),
  };
  if (!payload.adjuntos.length) return NextResponse.json({ ok: true, adjuntos: 0 });

  await enqueueJob('EMAIL_IN', payload as never, empresa.id);
  return NextResponse.json({ ok: true, adjuntos: payload.adjuntos.length });
}
