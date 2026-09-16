import { formatearCuit, normalizarCuit } from '@/lib/checks/cuit';

// Piezas puras del cliente del portal de ARCA: lectura de los formularios
// JSF del login, de la pantalla de representados de Mis Comprobantes y
// clasificación de las respuestas (que mienten con el status: sesión vencida
// y WAF devuelven 200 con HTML o con "BL…").

export function extraerViewState(html: string): string {
  const m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/) ?? html.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  if (!m) throw new Error('Login ARCA: no se encontró javax.faces.ViewState en el formulario.');
  return m[1];
}

export function extraerAccionFormulario(html: string, formId = 'F1'): string {
  const re = new RegExp(`<form[^>]*id="${formId}"[^>]*action="([^"]+)"`);
  const m = html.match(re) ?? html.match(new RegExp(`<form[^>]*action="([^"]+)"[^>]*id="${formId}"`));
  if (!m) throw new Error(`Login ARCA: no se encontró el formulario ${formId}.`);
  return m[1];
}

export type FalloLogin = 'credenciales' | 'captcha' | 'cambio_clave' | 'segundo_factor';

/**
 * Qué pasó cuando el login no llegó al portal. Todos estos casos se tratan
 * igual: NO se reintenta (bloquearía la Clave Fiscal) y se avisa.
 */
export function detectarFalloLogin(html: string): FalloLogin | null {
  const t = html.toLowerCase();
  if (/clave o usuario incorrecto|usuario o clave incorrect|clave incorrecta|cuit inv[aá]lido/.test(t)) return 'credenciales';
  if (/cambiar clave fiscal|cambio de clave|clave (ha )?vencid/.test(t)) return 'cambio_clave';
  if (/doble factor|segundo factor|app token|token arca|c[oó]digo de verificaci[oó]n/.test(t)) return 'segundo_factor';
  // El hidden F1:captcha existe siempre vacío; sólo cuenta si hay un desafío visible.
  if (/captcha\.(jpg|png)|c[oó]digo de la imagen|recaptcha|hcaptcha|turnstile/.test(t)) return 'captcha';
  return null;
}

/**
 * Índice de la empresa en "Elegí una persona para ingresar": se lee del
 * onclick de la tarjeta (clase hoverazul) cuyo texto trae el CUIT. No se
 * cuentan posiciones: la cabecera con el usuario logueado también tiene CUIT.
 */
export function indiceRepresentado(html: string, cuitEmpresa: string): number {
  const cuit = normalizarCuit(cuitEmpresa);
  const cuitConGuiones = formatearCuit(cuit);
  const re = /<a[^>]*class="[^"]*hoverazul[^"]*"[^>]*onclick="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const texto = m[2].replace(/<[^>]+>/g, ' ');
    if (!texto.includes(cuitConGuiones) && !normalizarCuit(texto).includes(cuit)) continue;
    const idx = m[1].match(/value='(\d+)'/) ?? m[1].match(/value="(\d+)"/);
    if (!idx) throw new Error(`Mis Comprobantes: la tarjeta de ${cuitConGuiones} no trae el índice en el onclick.`);
    return Number(idx[1]);
  }
  throw new Error(`Mis Comprobantes: la empresa ${cuitConGuiones} no está entre las personas que este usuario puede representar.`);
}

/** Después de setearContribuyente.do: la cabecera tiene que decir REPRESENTANDO A: … [CUIT]. */
export function verificarRepresentando(html: string, cuitEmpresa: string): boolean {
  const cuit = normalizarCuit(cuitEmpresa);
  const m = html.match(/REPRESENTANDO A:?([\s\S]{0,300})/i);
  if (!m) return false;
  return normalizarCuit(m[1].replace(/<[^>]+>/g, ' ')).includes(cuit);
}

export type RespuestaAjax =
  | { tipo: 'json'; json: unknown }
  | { tipo: 'sesion_vencida' }
  | { tipo: 'waf' }
  | { tipo: 'inesperada'; detalle: string };

export function clasificarRespuestaAjax(status: number, contentType: string, cuerpo: string): RespuestaAjax {
  const t = cuerpo.trim();
  if (/^BL\d+\s+\d{4}-\d{2}-\d{2}/.test(t)) return { tipo: 'waf' };
  if (status === 503 && !t) return { tipo: 'waf' };
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return { tipo: 'json', json: JSON.parse(t) };
    } catch {
      /* sigue */
    }
  }
  const bajo = t.toLowerCase();
  if (/no se encuentra logueado|sesi[oó]n (ha )?expir|sesi[oó]n expir/.test(bajo) || (status === 403 && /sesi[oó]n/.test(bajo))) {
    return { tipo: 'sesion_vencida' };
  }
  return { tipo: 'inesperada', detalle: `HTTP ${status} ${contentType || ''}: ${t.slice(0, 300)}` };
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** "dd/mm/yyyy - dd/mm/yyyy" (fechas en UTC, día calendario). Máximo 365 días. */
export function rangoFechasPortal(desde: Date, hasta: Date): string {
  const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000);
  if (dias < 0) throw new Error('Mis Comprobantes: el rango de fechas está invertido.');
  if (dias > 365) throw new Error('Mis Comprobantes: el rango máximo por consulta es de 365 días.');
  return `${ddmmyyyy(desde)} - ${ddmmyyyy(hasta)}`;
}

// ---------- redirecciones que no son 3xx ----------

export type RedireccionHtml = { method: 'GET'; url: string } | { method: 'POST'; url: string; body: string };

function decodificarEntidades(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * Los saltos entre auth.afip.gob.ar, el portal y los servicios no siempre son
 * 302: pueden ser un <meta refresh>, un `location.href = …` o un formulario
 * con hidden que se auto-envía. Devuelve el pedido a hacer, o null.
 */
export function redireccionEnHtml(html: string, urlBase: string): RedireccionHtml | null {
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']\s*\d+\s*;\s*url=([^"'>\s]+)/i);
  if (meta) return { method: 'GET', url: new URL(decodificarEntidades(meta[1]), urlBase).toString() };

  // Formulario auto-enviado: sólo hidden (sin campos visibles) y un submit() por script/onload.
  const autoSubmit = /\.submit\(\)/.test(html);
  if (autoSubmit) {
    for (const f of html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/gi)) {
      const apertura = f[0].slice(0, f[0].indexOf('>') + 1);
      const action = apertura.match(/action=["']([^"']*)["']/i)?.[1];
      const method = (apertura.match(/method=["']([^"']*)["']/i)?.[1] ?? 'GET').toUpperCase();
      const inputs = [...f[1].matchAll(/<input[^>]*>/gi)].map((m) => m[0]);
      const visibles = inputs.filter((i) => !/type=["']?(hidden|submit)/i.test(i));
      if (visibles.length > 0 || !action) continue;
      const campos: [string, string][] = [];
      for (const i of inputs) {
        if (!/type=["']?hidden/i.test(i)) continue;
        const name = i.match(/name=["']([^"']*)["']/i)?.[1];
        const value = i.match(/value=["']([^"']*)["']/i)?.[1] ?? '';
        if (name) campos.push([name, decodificarEntidades(value)]);
      }
      const url = new URL(decodificarEntidades(action), urlBase).toString();
      const body = campos.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      if (method === 'POST') return { method: 'POST', url, body };
      return { method: 'GET', url: body ? `${url}${url.includes('?') ? '&' : '?'}${body}` : url };
    }
  }

  const js = html.match(/(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/) ?? html.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/);
  if (js) return { method: 'GET', url: new URL(decodificarEntidades(js[1]), urlBase).toString() };
  return null;
}

/**
 * Resumen de una respuesta HTML para la traza técnica: título, formularios
 * (acción y nombres de campos, NUNCA sus valores), redirecciones y un
 * extracto del texto visible. Sirve para diagnosticar un login que no llegó
 * al portal sin exponer clave, ViewState, tokens ni cookies.
 */
export function resumenHtml(html: string): string {
  const partes: string[] = [];
  const titulo = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  if (titulo) partes.push(`título «${titulo.slice(0, 80)}»`);
  for (const f of html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const id = f[1].match(/id=["']([^"']*)["']/i)?.[1] ?? f[1].match(/name=["']([^"']*)["']/i)?.[1] ?? '';
    const action = (f[1].match(/action=["']([^"']*)["']/i)?.[1] ?? '').replace(/;jsessionid=[^?]*/i, ';jsessionid=***');
    const campos = [...f[2].matchAll(/<input[^>]*name=["']([^"']*)["']/gi)].map((m) => m[1]).slice(0, 12);
    partes.push(`form#${id}→${action} [${campos.join(', ')}]`);
  }
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']([^"']*)["']/i)?.[1];
  if (meta) partes.push(`meta-refresh «${meta.slice(0, 120)}»`);
  const js = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/)?.[1] ?? html.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']/)?.[1];
  if (js) partes.push(`js-location «${js.slice(0, 120)}»`);
  if (/\.submit\(\)/.test(html)) partes.push('auto-submit');
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (texto) partes.push(`texto «${texto.slice(0, 220)}»`);
  return partes.join(' · ').slice(0, 650);
}
