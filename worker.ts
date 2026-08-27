// Job queue worker: polls the Job table and runs the async pipeline
// (extraction, ARCA verification, channel ingestion). Run with `npm run worker`
// alongside `npm run dev`/`start`. Single DB, no Redis.
import { claimNextJob, completeJob, failJob } from '@/lib/jobs';
import { procesarExtraccion, procesarArca, marcarErrorProcesamiento } from '@/lib/pipeline';
import { procesarEmailEntrante } from '@/lib/canales/email';
import { procesarUpdateTelegram } from '@/lib/canales/telegram';
import { procesarExtraccionRecibo } from '@/lib/empleados/ingesta';
import { procesarExtraccionResumen } from '@/lib/resumenes/ingesta';

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
      case 'EXTRACCION_RESUMEN':
        await procesarExtraccionResumen(payload as { resumenId: string; empresaId: string });
        break;
      case 'EMAIL_IN':
        await procesarEmailEntrante(payload as never);
        break;
      case 'TELEGRAM_IN':
        await procesarUpdateTelegram(payload as never);
        break;
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
  }
  return true;
}

async function main() {
  console.log('[worker] iniciado. EXTRACTOR_MODE=%s ARCA_MODE=%s', process.env.EXTRACTOR_MODE ?? 'mock', process.env.ARCA_MODE ?? 'mock');
  process.on('SIGINT', () => { corriendo = false; });
  process.on('SIGTERM', () => { corriendo = false; });
  while (corriendo) {
    let huboTrabajo = false;
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
