import { prisma } from '@/lib/db';
import { enviarEmail, resendHabilitado } from '@/lib/canales/resend';

// Avisos por mail, a la casilla relevante según el alcance del problema:
//   USUARIO  un error en algo que cargó una persona (comprobante, resumen, recibo)
//   EMPRESA  un problema de la empresa (clave de ARCA bloqueada…): sus administradores
//   APP      un problema de la aplicación (API de Anthropic sin crédito…): el owner
// Best-effort: nunca lanza; sin Resend o sin destinatarios no hace nada.

export type Destino = { tipo: 'APP' } | { tipo: 'EMPRESA'; empresaId: string } | { tipo: 'USUARIO'; usuarioId: string };

const URL_APP = () => (process.env.APP_URL || 'https://pnl.ledger.ar').replace(/\/$/, '');

export async function destinatarios(d: Destino): Promise<string[]> {
  if (d.tipo === 'APP') {
    return (process.env.APP_OWNER_EMAIL ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  }
  if (d.tipo === 'EMPRESA') {
    const admins = await prisma.usuarioEmpresa.findMany({
      where: { empresaId: d.empresaId, rol: 'ADMINISTRADOR' },
      select: { usuario: { select: { email: true } } },
    });
    return admins.map((a) => a.usuario.email);
  }
  const u = await prisma.usuario.findUnique({ where: { id: d.usuarioId }, select: { email: true } });
  return u ? [u.email] : [];
}

export async function notificar(destinos: Destino | Destino[], asunto: string, texto: string): Promise<void> {
  try {
    if (!resendHabilitado()) return;
    const lista = Array.isArray(destinos) ? destinos : [destinos];
    const to = [...new Set((await Promise.all(lista.map(destinatarios))).flat().map((c) => c.toLowerCase()))];
    if (!to.length) return;
    await enviarEmail({ to, subject: asunto, text: `${texto}\n\n— P&L Manager · ${URL_APP()}` });
  } catch (err) {
    console.error(`[notificaciones] no se pudo mandar "${asunto}":`, err instanceof Error ? err.message : err);
  }
}

/**
 * Un documento cargado terminó con error de procesamiento (se agotaron los
 * intentos o la API lo rechazó): avisa a quien lo cargó.
 */
export async function notificarErrorCarga(tipoJob: string, payload: Record<string, any>, error: string): Promise<void> {
  try {
    let usuarioId: string | null = payload.usuarioId ?? null;
    let archivo = 'un documento';
    let que = 'el comprobante';
    if (tipoJob === 'EXTRACCION' && payload.movimientoId) {
      const mov = await prisma.movimiento.findUnique({ where: { id: payload.movimientoId }, select: { creadoPorId: true, archivoNombre: true } });
      usuarioId = mov?.creadoPorId ?? usuarioId;
      archivo = mov?.archivoNombre ?? archivo;
    } else if (tipoJob === 'EXTRACCION_RESUMEN' && payload.resumenId) {
      const r = await prisma.resumen.findUnique({ where: { id: payload.resumenId }, select: { archivoNombre: true } });
      archivo = r?.archivoNombre ?? archivo;
      que = 'el resumen';
    } else if (tipoJob === 'EXTRACCION_RECIBO') {
      archivo = payload.archivoNombre ?? archivo;
      que = payload.pagina ? `el recibo (página ${payload.pagina})` : 'el recibo';
    }
    if (!usuarioId) return;
    const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId }, select: { slug: true, razonSocial: true } });
    const enlace = empresa ? `${URL_APP()}/${empresa.slug}/carga` : URL_APP();
    await notificar(
      { tipo: 'USUARIO', usuarioId },
      `No se pudo procesar ${archivo}`,
      `No se pudo procesar ${que} "${archivo}"${empresa ? ` de ${empresa.razonSocial}` : ''}.\n\nError: ${error}\n\nRevisalo en ${enlace}`,
    );
  } catch (err) {
    console.error('[notificaciones] aviso de error de carga falló:', err instanceof Error ? err.message : err);
  }
}
