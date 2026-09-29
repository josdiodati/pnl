import type { AlertaSistema, Job } from '@prisma/client';
import { prisma } from '@/lib/db';
import { failJob, posponerJob } from '@/lib/jobs';
import { responder } from '@/lib/canales/telegram';
import { clasificarErrorIa, mensajeErrorIa, DESCRIPCION_ERROR_IA, type ErrorIa } from '@/lib/ia/errores';

// Alertas de la extracción con IA. Una alerta abierta por código de error: la
// ve todo usuario en un banner (layout de empresa), queda en el log del worker
// y, si ALERTAS_TELEGRAM_CHAT_ID está cargado, se avisa por Telegram al abrirse
// y al resolverse. Se cierra sola con la próxima extracción exitosa.

export const TIPOS_JOB_IA = new Set(['EXTRACCION', 'EXTRACCION_RECIBO', 'EXTRACCION_RESUMEN']);

/** Cada cuánto se vuelve a probar un job en espera por un error GLOBAL. */
export const ESPERA_ERROR_GLOBAL_MS = 10 * 60_000;

async function notificarTelegram(texto: string): Promise<void> {
  const chats = (process.env.ALERTAS_TELEGRAM_CHAT_ID ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  for (const chat of chats) {
    try {
      await responder(chat, texto);
    } catch (err) {
      console.error('[alertas] no se pudo avisar por Telegram:', err instanceof Error ? err.message : err);
    }
  }
}

/** Abre la alerta del código (o suma una ocurrencia a la abierta). */
export async function registrarAlertaIa(e: ErrorIa): Promise<{ nueva: boolean }> {
  const mensaje = mensajeErrorIa(e);
  console.error(`[ALERTA IA] ${mensaje}`);
  const abierta = await prisma.alertaSistema.findFirst({ where: { origen: 'IA', codigo: e.codigo, resueltaAt: null } });
  if (abierta) {
    await prisma.alertaSistema.update({
      where: { id: abierta.id },
      data: { ocurrencias: { increment: 1 }, ultimaVez: new Date(), mensaje, requestId: e.requestId },
    });
    return { nueva: false };
  }
  await prisma.alertaSistema.create({
    data: { origen: 'IA', codigo: e.codigo, titulo: e.titulo, accion: e.accion, mensaje, requestId: e.requestId },
  });
  await notificarTelegram(`⚠️ P&L Manager — extracción con IA con problemas\n${e.codigo}: ${e.titulo}\n\nQué hacer: ${e.accion}\n\n${mensaje}`);
  return { nueva: true };
}

/**
 * Una extracción anduvo: cierra las alertas de la API. SIN_CLAVE no se cierra
 * acá (el extractor de prueba también "anda"); lo maneja verificarConfiguracionIa.
 */
export async function resolverAlertasIa(): Promise<number> {
  const abiertas = await prisma.alertaSistema.findMany({ where: { origen: 'IA', resueltaAt: null, codigo: { not: 'SIN_CLAVE' } } });
  if (!abiertas.length) return 0;
  await prisma.alertaSistema.updateMany({ where: { id: { in: abiertas.map((a) => a.id) } }, data: { resueltaAt: new Date() } });
  const codigos = abiertas.map((a) => a.codigo).join(', ');
  console.log(`[alertas] resuelta(s): ${codigos}`);
  await notificarTelegram(`✅ P&L Manager — la extracción con IA volvió a funcionar (${codigos}).`);
  return abiertas.length;
}

/** Al arrancar el worker: EXTRACTOR_MODE=real sin clave cae al extractor de prueba en silencio. */
export async function verificarConfiguracionIa(): Promise<void> {
  const sinClave = process.env.EXTRACTOR_MODE === 'real' && !process.env.ANTHROPIC_API_KEY;
  if (sinClave) {
    const d = DESCRIPCION_ERROR_IA.SIN_CLAVE;
    await registrarAlertaIa({ codigo: 'SIN_CLAVE', ...d, status: null, tipoApi: null, mensajeApi: 'ANTHROPIC_API_KEY vacía', requestId: null });
    return;
  }
  await prisma.alertaSistema.updateMany({ where: { origen: 'IA', codigo: 'SIN_CLAVE', resueltaAt: null }, data: { resueltaAt: new Date() } });
}

/**
 * Registra el fallo de un job. Para los de IA, nombra el error de la API y
 * decide: GLOBAL => alerta + espera sin gastar intentos; TRANSITORIO =>
 * backoff y alerta si se agotan los intentos; DOCUMENTO/otro => backoff normal.
 * Devuelve `final` (el documento queda con error) y el mensaje a guardar.
 */
export async function registrarFalloJob(job: Job, err: unknown): Promise<{ final: boolean; mensaje: string }> {
  const ia = TIPOS_JOB_IA.has(job.tipo) ? clasificarErrorIa(err) : null;
  const mensaje = ia ? mensajeErrorIa(ia) : err instanceof Error ? err.message : String(err);
  if (ia?.alcance === 'GLOBAL') {
    await registrarAlertaIa(ia);
    await posponerJob(job, mensaje, ESPERA_ERROR_GLOBAL_MS);
    return { final: false, mensaje };
  }
  const { final } = await failJob(job, mensaje);
  if (final && ia?.alcance === 'TRANSITORIO') await registrarAlertaIa(ia);
  return { final, mensaje };
}

export type AlertaActiva = AlertaSistema & { enEspera: number };

/** Alertas abiertas con cuántos jobs de IA están esperando por ellas (banner). */
export async function alertasIaActivas(): Promise<AlertaActiva[]> {
  const alertas = await prisma.alertaSistema.findMany({ where: { origen: 'IA', resueltaAt: null }, orderBy: { primeraVez: 'asc' } });
  return Promise.all(
    alertas.map(async (a) => ({
      ...a,
      enEspera: await prisma.job.count({
        where: { tipo: { in: [...TIPOS_JOB_IA] }, estado: 'queued', error: { startsWith: `[${a.codigo}]` } },
      }),
    })),
  );
}
