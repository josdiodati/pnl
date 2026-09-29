import { prisma } from '@/lib/db';
import { enviarEmail, resendHabilitado } from '@/lib/canales/resend';
import { registrarEventoUnico } from '@/lib/canales/eventos';
import { etiquetaTipoDocumento, DIAS_RETENCION_NO_COMPROBANTE } from '@/lib/carga/no-comprobante';

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
 * intentos o la API lo rechazó): avisa a quien lo cargó. Un solo mail por
 * tanda (lote de ingesta), por PDF de recibos o por resumen: el primero que
 * falla avisa y los demás de la misma tanda no repiten.
 */
export async function notificarErrorCarga(tipoJob: string, payload: Record<string, any>, error: string): Promise<void> {
  try {
    let usuarioId: string | null = payload.usuarioId ?? null;
    let archivo = 'un documento';
    let que = 'el comprobante';
    let agrupador: string | null = null;
    let tanda = false;
    if (tipoJob === 'EXTRACCION' && payload.movimientoId) {
      const mov = await prisma.movimiento.findUnique({ where: { id: payload.movimientoId }, select: { creadoPorId: true, archivoNombre: true, loteId: true } });
      usuarioId = mov?.creadoPorId ?? usuarioId;
      archivo = mov?.archivoNombre ?? archivo;
      agrupador = mov?.loteId ? `lote:${mov.loteId}` : `mov:${payload.movimientoId}`;
      tanda = Boolean(mov?.loteId);
    } else if (tipoJob === 'EXTRACCION_RESUMEN' && payload.resumenId) {
      const r = await prisma.resumen.findUnique({ where: { id: payload.resumenId }, select: { archivoNombre: true } });
      archivo = r?.archivoNombre ?? archivo;
      que = 'el resumen';
      agrupador = `resumen:${payload.resumenId}`;
    } else if (tipoJob === 'EXTRACCION_RECIBO') {
      archivo = payload.archivoNombre ?? archivo;
      que = payload.pagina ? `el recibo (página ${payload.pagina})` : 'el recibo';
      agrupador = payload.archivoKey ? `recibos:${payload.archivoKey}` : null;
      tanda = true;
    }
    if (!usuarioId) return;
    if (agrupador && !(await registrarEventoUnico('AVISO', `carga:${agrupador}`))) return; // ya se avisó esta tanda
    const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId }, select: { slug: true, razonSocial: true } });
    const enlace = empresa ? `${URL_APP()}/${empresa.slug}/carga` : URL_APP();
    await notificar(
      { tipo: 'USUARIO', usuarioId },
      `No se pudo procesar ${archivo}`,
      `No se pudo procesar ${que} "${archivo}"${empresa ? ` de ${empresa.razonSocial}` : ''}.\n\nError: ${error}\n\n` +
        (tanda ? 'Otros documentos de la misma tanda pueden tener el mismo problema (no se manda un mail por cada uno).\n\n' : '') +
        `Revisalo en ${enlace}`,
    );
  } catch (err) {
    console.error('[notificaciones] aviso de error de carga falló:', err instanceof Error ? err.message : err);
  }
}

/**
 * Un documento que entró por mail o Telegram quedó apartado como "no es
 * comprobante": se avisa a quien figura como cargador (un mail por tanda),
 * porque se borra solo y nadie lo vio subir. Las subidas web no avisan: la
 * persona lo ve en el resultado de la tanda en Carga.
 */
export async function notificarNoComprobante(payload: { movimientoId: string; empresaId: string }): Promise<void> {
  try {
    const mov = await prisma.movimiento.findUnique({
      where: { id: payload.movimientoId },
      select: { creadoPorId: true, archivoNombre: true, loteId: true, canalIngreso: true, flags: true },
    });
    if (!mov || (mov.canalIngreso !== 'EMAIL' && mov.canalIngreso !== 'TELEGRAM')) return;
    if (!(await registrarEventoUnico('AVISO', `nocomp:${mov.loteId ?? payload.movimientoId}`))) return; // ya se avisó esta tanda
    const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId }, select: { slug: true, razonSocial: true } });
    const enlace = empresa ? `${URL_APP()}/${empresa.slug}/validacion?estado=NO_COMPROBANTE` : URL_APP();
    const archivo = mov.archivoNombre ?? 'un documento';
    await notificar(
      { tipo: 'USUARIO', usuarioId: mov.creadoPorId },
      `"${archivo}" no parece un comprobante`,
      `"${archivo}"${empresa ? `, que llegó a ${empresa.razonSocial}` : ''} por ${mov.canalIngreso === 'EMAIL' ? 'mail' : 'Telegram'}, no parece un comprobante (${etiquetaTipoDocumento(mov.flags)}). No entra al libro y se borra solo en ${DIAS_RETENCION_NO_COMPROBANTE} días.\n\n` +
        (mov.loteId ? 'Puede haber otros documentos de la misma tanda en la misma situación.\n\n' : '') +
        `Si es un comprobante, abrilo y tocá «Es un comprobante»: ${enlace}`,
    );
  } catch (err) {
    console.error('[notificaciones] aviso de no comprobante falló:', err instanceof Error ? err.message : err);
  }
}
