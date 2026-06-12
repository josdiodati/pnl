import { prisma } from '@/lib/db';
import type { Job } from '@prisma/client';

// DB-backed job queue (no Redis). A single worker polls the Job table; claims
// are atomic via conditional updateMany, retries use exponential backoff.

export type TipoJob = 'EXTRACCION' | 'ARCA' | 'RECURRENTES' | 'EMAIL_IN' | 'TELEGRAM_IN';

const BACKOFF_BASE_MS = 30_000; // 30s, 60s, 120s...

export async function enqueueJob(tipo: TipoJob, payload: Record<string, unknown>, empresaId?: string | null): Promise<Job> {
  return prisma.job.create({
    data: { tipo, payload: payload as never, empresaId: empresaId ?? null },
  });
}

/** Claims the next runnable job atomically. Returns null if the queue is idle. */
export async function claimNextJob(): Promise<Job | null> {
  const now = new Date();
  // Small loop guards against races if more than one worker is running.
  for (let i = 0; i < 5; i++) {
    const candidate = await prisma.job.findFirst({
      where: {
        estado: 'queued',
        OR: [{ proximoIntento: null }, { proximoIntento: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, estado: 'queued' },
      data: { estado: 'processing', intentos: { increment: 1 } },
    });
    if (claimed.count === 1) {
      return prisma.job.findUniqueOrThrow({ where: { id: candidate.id } });
    }
  }
  return null;
}

export async function completeJob(id: string): Promise<void> {
  await prisma.job.update({ where: { id }, data: { estado: 'done', error: null } });
}

/**
 * Marks a failed attempt. Requeues with exponential backoff until maxIntentos,
 * then marks the job failed permanently. Returns whether it was final.
 */
export async function failJob(job: Job, error: unknown): Promise<{ final: boolean }> {
  const message = error instanceof Error ? error.message : String(error);
  const final = job.intentos >= job.maxIntentos;
  await prisma.job.update({
    where: { id: job.id },
    data: final
      ? { estado: 'failed', error: message }
      : {
          estado: 'queued',
          error: message,
          proximoIntento: new Date(Date.now() + BACKOFF_BASE_MS * 2 ** (job.intentos - 1)),
        },
  });
  return { final };
}
