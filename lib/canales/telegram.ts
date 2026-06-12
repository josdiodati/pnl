import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { writeAudit } from '@/lib/audit';
import { ingestarComprobante, resolverCreadorCanal } from '@/lib/pipeline';

// Telegram channel. A chat links itself to ONE company via `/vincular {code}`
// (the code is generated in the company config screen). Afterwards every photo
// or document sent to the bot enters that company's pipeline. Without
// TELEGRAM_BOT_TOKEN the channel is disabled for real traffic, but the webhook
// still accepts mock payloads carrying `_mock_file_base64` so the full flow is
// testable with zero credentials.

export function telegramHabilitado(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export function generarCodigoVinculo(): string {
  return randomBytes(4).toString('hex').toUpperCase(); // e.g. "9F3A21BC"
}

async function api(metodo: string, body: Record<string, unknown>): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null; // mock mode: replies are no-ops
  const res = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function responder(chatId: string | number, texto: string): Promise<void> {
  await api('sendMessage', { chat_id: chatId, text: texto });
}

/** Links a chat to the company that owns the given code. Returns the reply text. */
export async function vincularChat(chatId: string, codigo: string): Promise<string> {
  const empresa = await prisma.empresa.findFirst({ where: { telegramCodigoVinculo: codigo.toUpperCase() } });
  if (!empresa) return 'Código de vínculo inválido. Generá uno nuevo en Configuración → Telegram.';
  const existente = await prisma.telegramVinculo.findUnique({ where: { chatId } });
  if (existente) {
    await prisma.telegramVinculo.update({ where: { chatId }, data: { empresaId: empresa.id } });
  } else {
    await prisma.telegramVinculo.create({ data: { chatId, empresaId: empresa.id } });
  }
  await writeAudit(scopedDb(empresa.id), {
    entidad: 'TelegramVinculo',
    entidadId: chatId,
    accion: existente ? 'REVINCULAR' : 'VINCULAR',
    despues: { chatId },
  });
  return `Listo: este chat quedó vinculado a ${empresa.razonSocial}. Mandá fotos o PDFs de comprobantes y los proceso.`;
}

export type TelegramInPayload = {
  updateId: number;
  chatId: string;
  fileId?: string | null;
  fileName?: string | null;
  mime?: string | null;
  /** Mock-mode only: file content inline (real Telegram never sends this). */
  mockFileBase64?: string | null;
};

async function descargarArchivo(fileId: string): Promise<Buffer> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado: no se puede descargar el archivo');
  const info = await api('getFile', { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) throw new Error('Telegram no devolvió file_path');
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
  if (!res.ok) throw new Error(`Descarga de archivo falló: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function procesarUpdateTelegram(payload: TelegramInPayload): Promise<void> {
  const vinculo = await prisma.telegramVinculo.findUnique({ where: { chatId: payload.chatId } });
  if (!vinculo) {
    await responder(payload.chatId, 'Este chat no está vinculado a ninguna empresa. Usá /vincular {código}.');
    return;
  }
  const creadorId = await resolverCreadorCanal(vinculo.empresaId);
  if (!creadorId) throw new Error('La empresa vinculada no tiene usuarios');

  let buffer: Buffer;
  if (payload.mockFileBase64) {
    buffer = Buffer.from(payload.mockFileBase64, 'base64');
  } else if (payload.fileId) {
    buffer = await descargarArchivo(payload.fileId);
  } else {
    return; // nothing ingestable in this update
  }

  const { movimientoId } = await ingestarComprobante({
    empresaId: vinculo.empresaId,
    usuarioId: creadorId,
    buffer,
    filename: payload.fileName ?? 'telegram.jpg',
    mime: payload.mime ?? 'image/jpeg',
    canal: 'TELEGRAM',
  });
  await responder(payload.chatId, `Recibido ✔. Lo estoy procesando (movimiento ${movimientoId.slice(-6)}). Te aviso si queda algo para revisar.`);
}

/** Idempotency guard shared by both webhooks. True = first time seen. */
export async function registrarEventoUnico(canal: 'EMAIL' | 'TELEGRAM', claveExterna: string): Promise<boolean> {
  try {
    await prisma.eventoWebhook.create({ data: { canal, claveExterna } });
    return true;
  } catch {
    return false; // unique violation: already processed
  }
}
