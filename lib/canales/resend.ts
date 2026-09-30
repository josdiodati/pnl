// Cliente mínimo de la API de Resend (envío y recepción de mails) sobre
// fetch. Sin RESEND_API_KEY el canal queda apagado. El `f` opcional es para
// los tests. Recepción por polling: ver lib/canales/resend-entrante.ts.

const API = 'https://api.resend.com';
const REMITENTE_DEFAULT = 'P&L Manager <avisos@ledger.ar>';

export type RecibidoResend = { id: string; from: string; to: string[]; subject: string; created_at: string };
export type AdjuntoResend = {
  id: string; filename: string; content_type: string; content_disposition: string | null; size: number; download_url: string;
};

export function resendHabilitado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function llamar(path: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<any> {
  const res = await f(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${cuerpo?.message ?? res.statusText}`);
  return cuerpo;
}

export async function enviarEmail(m: { to: string[]; subject: string; text: string }, f?: typeof fetch): Promise<void> {
  const from = process.env.EMAIL_REMITENTE || REMITENTE_DEFAULT;
  await llamar('/emails', { method: 'POST', body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text }) }, f);
}

/** Una página de recibidos, del más nuevo al más viejo; `after` pide la página siguiente (más vieja). */
export async function listarRecibidos(after?: string, f?: typeof fetch): Promise<{ data: RecibidoResend[]; hasMore: boolean }> {
  const r = await llamar(`/emails/receiving?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, {}, f);
  return { data: r.data ?? [], hasMore: Boolean(r.has_more) };
}

export type AutenticacionResend = { spf?: string; dkim?: string; dmarc?: string } | null;

/** Detalle de un mail recibido; se usa el veredicto de SPF/DKIM/DMARC. */
export async function obtenerRecibido(emailId: string, f?: typeof fetch): Promise<{ authentication: AutenticacionResend }> {
  const r = await llamar(`/emails/receiving/${encodeURIComponent(emailId)}`, {}, f);
  return { authentication: r.authentication ?? null };
}

export async function listarAdjuntos(emailId: string, f?: typeof fetch): Promise<AdjuntoResend[]> {
  return (await llamar(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {}, f)).data ?? [];
}

/** La download_url es un link firmado temporal (1 h): no lleva la key. */
export async function descargarAdjunto(url: string, f: typeof fetch = fetch): Promise<Buffer> {
  const res = await f(url);
  if (!res.ok) throw new Error(`Resend adjunto ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
