import { prisma } from '@/lib/db';

// Idempotencia de eventos externos (ids de mails, updates de Telegram, mails
// de Resend) y de avisos ya mandados. Módulo aparte para que lo usen el
// pipeline y las notificaciones sin importar el canal de Telegram (que a su
// vez importa el pipeline).

export type CanalEvento = 'EMAIL' | 'TELEGRAM' | 'RESEND' | 'AVISO';

/** true la primera vez; false si ya estaba registrado. */
export async function registrarEventoUnico(canal: CanalEvento, claveExterna: string): Promise<boolean> {
  try {
    await prisma.eventoWebhook.create({ data: { canal, claveExterna } });
    return true;
  } catch {
    return false; // unique violation: already processed
  }
}

export async function yaRegistrado(canal: CanalEvento, claveExterna: string): Promise<boolean> {
  return (await prisma.eventoWebhook.count({ where: { canal, claveExterna } })) > 0;
}
