import { NextRequest, NextResponse } from 'next/server';
import { enqueueJob } from '@/lib/jobs';
import {
  vincularChat,
  responder,
  registrarEventoUnico,
  telegramHabilitado,
  type TelegramInPayload,
} from '@/lib/canales/telegram';

// Telegram bot webhook. Real mode requires TELEGRAM_BOT_TOKEN (+ optionally
// TELEGRAM_WEBHOOK_SECRET, checked against Telegram's secret-token header).
// Without a token the endpoint still accepts mock updates that carry the file
// inline as `_mock_file_base64`, so the whole channel is testable offline.
// Updates are deduped by update_id (Telegram retries on timeouts).
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Secret inválido' }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const updateId = update.update_id;
  const message = update.message ?? update.channel_post;
  if (updateId == null || !message?.chat?.id) {
    return NextResponse.json({ ok: true, ignorado: true });
  }
  const chatId = String(message.chat.id);

  const primeraVez = await registrarEventoUnico('TELEGRAM', String(updateId));
  if (!primeraVez) return NextResponse.json({ ok: true, duplicado: true });

  // /vincular {codigo}: links this chat to a company (code from config screen)
  const texto: string | undefined = message.text;
  if (texto?.startsWith('/vincular')) {
    const codigo = texto.split(/\s+/)[1] ?? '';
    const respuesta = await vincularChat(chatId, codigo);
    await responder(chatId, respuesta);
    return NextResponse.json({ ok: true, respuesta });
  }
  if (texto?.startsWith('/start')) {
    const ayuda = 'Hola. Vinculá este chat a tu empresa con /vincular {código} (lo generás en Configuración → Telegram) y después mandame fotos o PDFs de comprobantes.';
    await responder(chatId, ayuda);
    return NextResponse.json({ ok: true, respuesta: ayuda });
  }

  // Photo (best resolution) or document
  let payload: TelegramInPayload | null = null;
  if (message.document) {
    payload = {
      updateId,
      chatId,
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? 'documento.pdf',
      mime: message.document.mime_type ?? 'application/pdf',
      mockFileBase64: message._mock_file_base64 ?? null,
    };
  } else if (Array.isArray(message.photo) && message.photo.length) {
    const mejor = message.photo[message.photo.length - 1];
    payload = {
      updateId,
      chatId,
      fileId: mejor.file_id,
      fileName: 'foto-telegram.jpg',
      mime: 'image/jpeg',
      mockFileBase64: message._mock_file_base64 ?? null,
    };
  }

  if (!payload) {
    return NextResponse.json({ ok: true, ignorado: true });
  }
  if (!telegramHabilitado() && !payload.mockFileBase64) {
    return NextResponse.json(
      { error: 'Canal Telegram deshabilitado: configurá TELEGRAM_BOT_TOKEN, o incluí _mock_file_base64 en el message para probar sin credenciales.' },
      { status: 503 },
    );
  }

  await enqueueJob('TELEGRAM_IN', payload as never);
  return NextResponse.json({ ok: true, encolado: true });
}
