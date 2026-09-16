// Job queue worker: polls the Job table and runs the async pipeline
// (extraction, ARCA verification, channel ingestion). Run with `npm run worker`
// alongside `npm run dev`/`start`. Single DB, no Redis.
import { claimNextJob, completeJob, failJob } from '@/lib/jobs';
import { procesarExtraccion, procesarArca, marcarErrorProcesamiento } from '@/lib/pipeline';
import { procesarEmailEntrante } from '@/lib/canales/email';
import { procesarUpdateTelegram } from '@/lib/canales/telegram';
import { procesarExtraccionRecibo } from '@/lib/empleados/ingesta';
import { procesarExtraccionResumen, marcarErrorProcesamientoResumen } from '@/lib/resumenes/ingesta';
import { aplicarReglasResumen } from '@/lib/resumenes/reglas';
import { sincronizarMisComprobantes, encolarSyncsPendientes } from '@/lib/arca/mis-comprobantes/service';
import { scopedDb } from '@/lib/empresa/scope';

const POLL_MS = 2000;
let corriendo = true;

async function procesarJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  const payload = job.payload as never as Record<string, any>;
  console.log(`[worker] job ${job.id} (${job.tipo}) intento ${job.intentos}/${job.maxIntentos}`);
  try {
    switch (job.tipo) {
      case 'EXTRACCION':
        await procesarExtraccion(payload as { movimientoId: string; empresaId: string });
        break;
      case 'ARCA':
        await procesarArca(payload as { movimientoId: string; empresaId: string });
        break;
      case 'EXTRACCION_RECIBO':
        await procesarExtraccionRecibo(payload as never);
        break;
      case 'EXTRACCION_RESUMEN': {
        const p = payload as { resumenId: string; empresaId: string; usuarioId?: string };
        await procesarExtraccionResumen(p);
        // Auto-resolución por reglas de resumen (a nombre de quien lo subió).
        await aplicarReglasResumen(scopedDb(p.empresaId), p.resumenId, p.usuarioId);
        break;
      }
      case 'EMAIL_IN':
        await procesarEmailEntrante(payload as never);
        break;
      case 'TELEGRAM_IN':
        await procesarUpdateTelegram(payload as never);
        break;
      case 'SYNC_MIS_COMPROBANTES': {
        // Un login por corrida. Si ARCA rechaza la clave, el servicio bloquea
        // la credencial y devuelve sin lanzar: el job NO reintenta (reintentar
        // bloquearía la Clave Fiscal). Otros errores sí se propagan (backoff).
        const p = payload as { empresaId: string; usuarioId?: string | null };
        const r = await sincronizarMisComprobantes(p.empresaId, { usuarioId: p.usuarioId ?? null });
        console.log(`[worker] sync Mis Comprobantes ${p.empresaId}: ${JSON.stringify(r)}`);
        break;
      }
      default:
        throw new Error(`Tipo de job desconocido: ${job.tipo}`);
    }
    await completeJob(job.id);
  } catch (err) {
    console.error(`[worker] job ${job.id} falló:`, err instanceof Error ? err.message : err);
    const { final } = await failJob(job, err);
    if (final && job.tipo === 'EXTRACCION' && payload.movimientoId && payload.empresaId) {
      await marcarErrorProcesamiento(
        { movimientoId: payload.movimientoId, empresaId: payload.empresaId },
        err instanceof Error ? err.message : String(err),
      );
    }
    if (final && job.tipo === 'EXTRACCION_RESUMEN' && payload.resumenId && payload.empresaId) {
      await marcarErrorProcesamientoResumen(
        { resumenId: payload.resumenId, empresaId: payload.empresaId },
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return true;
}

const PROGRAMADOR_MS = 60_000;
let ultimoProgramador = 0;

/** Tareas programadas (sync diario de Mis Comprobantes a las 06:30 AR): se revisan una vez por minuto. */
async function correrProgramador(): Promise<void> {
  if (Date.now() - ultimoProgramador < PROGRAMADOR_MS) return;
  ultimoProgramador = Date.now();
  try {
    const n = await encolarSyncsPendientes();
    if (n > 0) console.log(`[worker] programador: ${n} sync(s) de Mis Comprobantes encolado(s)`);
  } catch (err) {
    console.error('[worker] programador falló:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  console.log('[worker] iniciado. EXTRACTOR_MODE=%s ARCA_MODE=%s', process.env.EXTRACTOR_MODE ?? 'mock', process.env.ARCA_MODE ?? 'mock');
  process.on('SIGINT', () => { corriendo = false; });
  process.on('SIGTERM', () => { corriendo = false; });
  while (corriendo) {
    let huboTrabajo = false;
    await correrProgramador();
    try {
      huboTrabajo = await procesarJob();
    } catch (err) {
      console.error('[worker] error inesperado:', err);
    }
    if (!huboTrabajo) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log('[worker] detenido.');
}

main();
