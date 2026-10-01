import type { Rol } from '@prisma/client';
import { enviarEmail, resendHabilitado } from '@/lib/canales/resend';
import { ROL_LABEL } from '@/lib/roles';

// Invitaciones por mail: el invitado recibe el enlace a /invitacion/<token>.
// A diferencia de los avisos (lib/notificaciones), el resultado se informa a
// quien invita: si el mail no sale, copia el enlace de Configuración a mano.

export type DatosInvitacion = {
  email: string;
  rol: Rol;
  token: string;
  empresa: string; // razón social
  invitadoPor: string;
  cuentaExistente: boolean; // ya tiene usuario (de otra empresa): entra con su contraseña
};

const URL_APP = () => (process.env.APP_URL || 'https://pnl.ledger.ar').replace(/\/$/, '');

export function enlaceInvitacion(token: string): string {
  return `${URL_APP()}/invitacion/${token}`;
}

export function mailInvitacion(d: DatosInvitacion): { subject: string; text: string } {
  const paso = d.cuentaExistente
    ? `Ya tenés cuenta con ${d.email}: entrá al enlace y aceptá con tu contraseña actual.`
    : 'Entrá al enlace, completá tu nombre y elegí una contraseña (mínimo 8 caracteres) para crear tu cuenta.';
  return {
    subject: `Te invitaron a ${d.empresa} en P&L Manager`,
    text: [
      `${d.invitadoPor} te invitó a ${d.empresa} en P&L Manager con el rol ${ROL_LABEL[d.rol]}.`,
      '',
      paso,
      '',
      enlaceInvitacion(d.token),
      '',
      'El enlace es personal y sirve una sola vez. Si no esperabas esta invitación, ignorá este mail.',
      '',
      `— P&L Manager · ${URL_APP()}`,
    ].join('\n'),
  };
}

/** Nunca lanza: devuelve si el mail salió y, si no, por qué. */
export async function enviarInvitacion(d: DatosInvitacion): Promise<{ enviado: true } | { enviado: false; motivo: string }> {
  if (!resendHabilitado()) return { enviado: false, motivo: 'El envío de mails no está configurado.' };
  try {
    await enviarEmail({ to: [d.email], ...mailInvitacion(d) });
    return { enviado: true };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error(`[invitaciones] no se pudo mandar la invitación a ${d.email}:`, motivo);
    return { enviado: false, motivo };
  }
}
