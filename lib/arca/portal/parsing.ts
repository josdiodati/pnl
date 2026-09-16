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
