import { normalizarCuit } from '@/lib/checks/cuit';
import { parsearCsvMisComprobantes } from '@/lib/arca/mis-comprobantes/csv';
import { extraerCsvDeZip } from '@/lib/arca/mis-comprobantes/zip';
import type { FilaMisComprobantes, OrigenMisComprobantes } from '@/lib/arca/mis-comprobantes/tipos';
import {
  clasificarRespuestaAjax,
  detectarFalloLogin,
  extraerAccionFormulario,
  extraerViewState,
  indiceRepresentado,
  rangoFechasPortal,
  verificarRepresentando,
} from './parsing';

// Cliente del portal de ARCA con Clave Fiscal para bajar "Mis Comprobantes",
// SIN navegador: el flujo relevado el 16-sep-2026 es HTTP puro (dos POST del
// login JSF, un ticket de la API del portal, un POST token/sign al servicio,
// y GETs a ajax.do). Reglas que salieron del relevamiento:
//  - Nunca confiar en el status: sesión vencida y WAF devuelven 200 con HTML
//    o con "BL…"; toda respuesta se clasifica parseándola.
//  - La consulta son TRES pasos en orden: generarConsulta → estimarResultados
//    → listaResultados. Sin el del medio queda clavada.
//  - El representado se elige por índice leído del onclick, y se verifica la
//    cabecera "REPRESENTANDO A:" antes de consultar.
//  - Un solo intento de login. Si falla, NO se reintenta: ARCA bloquea la
//    Clave Fiscal tras varios intentos fallidos.
//  - ~1,2 s entre llamadas: encadenarlas sin pausa dispara el WAF.

export type PedidoHttp = { method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string };
export type RespuestaHttp = { status: number; headers: Record<string, string>; setCookies: string[]; body: Buffer };
export type Transporte = (pedido: PedidoHttp) => Promise<RespuestaHttp>;

export const URL_LOGIN = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml';
export const URL_PORTAL = 'https://portalcf.cloud.afip.gob.ar/portal/app/';
export const URL_PORTAL_API = 'https://portalcf.cloud.afip.gob.ar/portal/api';
export const URL_MCMP = 'https://fes.afip.gob.ar/mcmp/jsp';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PAUSA_MS = 1200;
const REINTENTOS_WAF = 3;
const TIMEOUT_MS = 60_000;

export type MotivoLogin = 'credenciales' | 'captcha' | 'cambio_clave' | 'segundo_factor' | 'desconocido';

/** El login no llegó al portal. No se reintenta: podría bloquear la Clave Fiscal. */
export class ErrorLoginArca extends Error {
  readonly name = 'ErrorLoginArca';
  constructor(readonly motivo: MotivoLogin, mensaje: string) {
    super(mensaje);
  }
}
/** La sesión del portal/servicio murió en el medio: hay que re-loguear. */
export class ErrorSesionVencida extends Error {
  readonly name = 'ErrorSesionVencida';
}
/** Falla que no es de credenciales: WAF agotado, portal caído, HTML cambiado. */
export class ErrorPortalArca extends Error {
  readonly name = 'ErrorPortalArca';
}

export const MENSAJE_LOGIN: Record<MotivoLogin, string> = {
  credenciales: 'ARCA rechazó el usuario o la Clave Fiscal.',
  captcha: 'ARCA pidió un CAPTCHA en el login.',
  cambio_clave: 'ARCA exige cambiar la Clave Fiscal antes de seguir.',
  segundo_factor: 'ARCA pidió un segundo factor (Token / código de verificación).',
  desconocido: 'El login no llegó al portal de ARCA y no se reconoció el motivo.',
};

/** Transporte real: fetch sin seguir redirecciones (las cookies de cada salto se capturan a mano). */
export const transporteFetch: Transporte = async (p) => {
  const res = await fetch(p.url, {
    method: p.method,
    headers: p.headers,
    body: p.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const setCookies = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : [];
  return { status: res.status, headers, setCookies, body: Buffer.from(await res.arrayBuffer()) };
};

// ---------- cookies ----------

class Cookies {
  // dominio → nombre → valor. Dominio sin punto inicial.
  private jar = new Map<string, Map<string, string>>();

  guardar(setCookies: string[], hostPedido: string): void {
    for (const sc of setCookies) {
      const [par, ...attrs] = sc.split(';');
      const i = par.indexOf('=');
      if (i < 0) continue;
      const nombre = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      const dominioAttr = attrs.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith('domain='));
      const dominio = (dominioAttr ? dominioAttr.slice(7) : hostPedido).replace(/^\./, '').toLowerCase();
      if (!this.jar.has(dominio)) this.jar.set(dominio, new Map());
      this.jar.get(dominio)!.set(nombre, valor);
    }
  }

  cabecera(host: string): string | undefined {
    const pares: string[] = [];
    for (const [dominio, cookies] of this.jar) {
      if (host === dominio || host.endsWith(`.${dominio}`)) for (const [n, v] of cookies) pares.push(`${n}=${v}`);
    }
    return pares.length ? pares.join('; ') : undefined;
  }

  borrarDominio(dominio: string): void {
    this.jar.delete(dominio);
  }
}

function hostDe(url: string): string {
  return new URL(url).host.toLowerCase();
}

function form(campos: Record<string, string>): string {
  return Object.entries(campos)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

const dormir = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// ---------- cliente ----------

export type OpcionesCliente = { transporte?: Transporte; pausaMs?: number; userAgent?: string };

export class ClientePortalArca {
  private transporte: Transporte;
  private pausaMs: number;
  private userAgent: string;
  private cookies = new Cookies();
  private cuitUsuario: string | null = null;
  private ultimaLlamada = 0;

  constructor(opts: OpcionesCliente = {}) {
    this.transporte = opts.transporte ?? transporteFetch;
    this.pausaMs = opts.pausaMs ?? PAUSA_MS;
    this.userAgent = opts.userAgent ?? USER_AGENT;
  }

  private async pedir(p: PedidoHttp, extra: Record<string, string> = {}): Promise<RespuestaHttp> {
    // Ritmo: nunca dos llamadas a menos de pausaMs (el WAF corta las ráfagas).
    const espera = this.ultimaLlamada + this.pausaMs - Date.now();
    if (espera > 0) await dormir(espera);
    const host = hostDe(p.url);
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'es-AR,es;q=0.9',
      ...(p.headers ?? {}),
      ...extra,
    };
    const cookie = this.cookies.cabecera(host);
    if (cookie) headers.cookie = cookie;
    if (p.method === 'POST' && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded';
    this.ultimaLlamada = Date.now();
    const res = await this.transporte({ ...p, headers });
    this.cookies.guardar(res.setCookies, host);
    return res;
  }

  /** GET/POST siguiendo redirecciones (máx. 5) y acumulando cookies de cada salto. */
  private async navegar(p: PedidoHttp): Promise<{ res: RespuestaHttp; url: string }> {
    let pedido = p;
    for (let salto = 0; salto < 6; salto++) {
      const res = await this.pedir(pedido);
      const loc = res.headers.location;
      if (res.status >= 300 && res.status < 400 && loc) {
        pedido = { method: 'GET', url: new URL(loc, pedido.url).toString() };
        continue;
      }
      return { res, url: pedido.url };
    }
    throw new ErrorPortalArca('Demasiadas redirecciones en el portal de ARCA.');
  }

  private texto(res: RespuestaHttp): string {
    // El HTML del portal es ISO-8859-1; el JSON y el CSV, UTF-8. Para lo que
    // se busca (ids, CUITs, mensajes) latin1 alcanza y no rompe con UTF-8.
    const ct = res.headers['content-type'] ?? '';
    return res.body.toString(/utf-?8/i.test(ct) || /json/i.test(ct) ? 'utf8' : 'latin1');
  }

  /**
   * Login con Clave Fiscal: exactamente un intento. Si no llega al portal,
   * lanza ErrorLoginArca con el motivo (credenciales, captcha, cambio de
   * clave, segundo factor o desconocido) y nunca reintenta.
   */
  async login(cuitUsuario: string, clave: string): Promise<{ cuit: string }> {
    const cuit = normalizarCuit(cuitUsuario);
    this.cuitUsuario = null;
    this.cookies = new Cookies();

    const paso0 = await this.navegar({ method: 'GET', url: URL_LOGIN });
    const html0 = this.texto(paso0.res);
    let viewState: string;
    let accion: string;
    try {
      viewState = extraerViewState(html0);
      accion = extraerAccionFormulario(html0);
    } catch (e) {
      throw new ErrorLoginArca('desconocido', `La página de login de ARCA cambió: ${(e as Error).message}`);
    }

    const paso1 = await this.navegar({
      method: 'POST',
      url: new URL(accion, paso0.url).toString(),
      body: form({ F1: 'F1', 'F1:username': cuit, 'F1:btnSiguiente': 'Siguiente', 'javax.faces.ViewState': viewState }),
    });
    const html1 = this.texto(paso1.res);
    const fallo1 = detectarFalloLogin(html1);
    if (fallo1) throw new ErrorLoginArca(fallo1, MENSAJE_LOGIN[fallo1]);
    let viewState2: string;
    let accion2: string;
    try {
      viewState2 = extraerViewState(html1);
      accion2 = extraerAccionFormulario(html1);
    } catch (e) {
      throw new ErrorLoginArca('desconocido', `La pantalla de clave de ARCA cambió: ${(e as Error).message}`);
    }

    const paso2 = await this.navegar({
      method: 'POST',
      url: new URL(accion2, paso1.url).toString(),
      body: form({ F1: 'F1', 'F1:captcha': '', 'F1:username': cuit, 'F1:password': clave, 'F1:btnIngresar': 'Ingresar', 'javax.faces.ViewState': viewState2 }),
    });
    const html2 = this.texto(paso2.res);
    const fallo2 = detectarFalloLogin(html2);
    if (fallo2) throw new ErrorLoginArca(fallo2, MENSAJE_LOGIN[fallo2]);

    // Confirmación: la API del portal responde JSON con el CUIT logueado.
    if (!paso2.url.includes('portalcf')) await this.navegar({ method: 'GET', url: URL_PORTAL });
    const info = await this.pedir({ method: 'GET', url: `${URL_PORTAL_API}/info` }, { accept: 'application/json' });
    const clas = clasificarRespuestaAjax(info.status, info.headers['content-type'] ?? '', this.texto(info));
    const infoJson = clas.tipo === 'json' ? (clas.json as { cuit?: number | string }) : null;
    if (!infoJson?.cuit) {
      throw new ErrorLoginArca('desconocido', MENSAJE_LOGIN.desconocido);
    }
    this.cuitUsuario = cuit;
    return { cuit: String(infoJson.cuit) };
  }

  /** Ticket del portal + handshake a Mis Comprobantes + representado verificado. */
  async abrirMisComprobantes(cuitEmpresa: string): Promise<void> {
    if (!this.cuitUsuario) throw new ErrorPortalArca('Hay que loguearse antes de abrir Mis Comprobantes.');
    const cuit = normalizarCuit(cuitEmpresa);
    const aut = await this.pedir(
      { method: 'GET', url: `${URL_PORTAL_API}/servicios/${this.cuitUsuario}/servicio/mcmp/autorizacion` },
      { accept: 'application/json' },
    );
    const clas = clasificarRespuestaAjax(aut.status, aut.headers['content-type'] ?? '', this.texto(aut));
    if (clas.tipo === 'sesion_vencida') throw new ErrorSesionVencida('La sesión del portal de ARCA venció.');
    const ticket = clas.tipo === 'json' ? (clas.json as { token?: string; sign?: string }) : null;
    if (!ticket?.token || !ticket?.sign) throw new ErrorPortalArca('El portal de ARCA no entregó el ticket de acceso a Mis Comprobantes.');

    // Handshake: sin este POST un GET a index.do devuelve 403.
    this.cookies.borrarDominio('fes.afip.gob.ar');
    const index = await this.navegar({ method: 'POST', url: `${URL_MCMP}/index.do`, body: form({ token: ticket.token, sign: ticket.sign }) });
    const htmlIndex = this.texto(index.res);
    if (index.res.status === 403) throw new ErrorSesionVencida('Mis Comprobantes rechazó el ticket (sesión expirada).');
    let indice: number;
    try {
      indice = indiceRepresentado(htmlIndex, cuit);
    } catch (e) {
      throw new ErrorPortalArca((e as Error).message);
    }
    const menu = await this.navegar({ method: 'GET', url: `${URL_MCMP}/setearContribuyente.do?idContribuyente=${indice}` });
    if (!verificarRepresentando(this.texto(menu.res), cuit)) {
      throw new ErrorPortalArca(`Mis Comprobantes no quedó REPRESENTANDO A la empresa ${cuit}: se aborta para no consultar datos de otra persona.`);
    }
  }

  private async ajax(f: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ f, ...params }).toString().replace(/\+/g, '%20');
    for (let intento = 1; ; intento++) {
      const res = await this.pedir(
        { method: 'GET', url: `${URL_MCMP}/ajax.do?${query}` },
        { accept: 'application/json, text/javascript, */*; q=0.01', 'x-requested-with': 'XMLHttpRequest' },
      );
      const clas = clasificarRespuestaAjax(res.status, res.headers['content-type'] ?? '', this.texto(res));
      if (clas.tipo === 'json') return clas.json;
      if (clas.tipo === 'sesion_vencida') throw new ErrorSesionVencida('La sesión de Mis Comprobantes venció.');
      if (clas.tipo === 'waf' && intento < REINTENTOS_WAF) {
        await dormir(this.pausaMs * 2 * intento);
        continue;
      }
      throw new ErrorPortalArca(clas.tipo === 'waf' ? 'El WAF de ARCA bloqueó la consulta repetidas veces.' : `Respuesta inesperada de Mis Comprobantes (${f}): ${clas.detalle}`);
    }
  }

  /**
   * Consulta emitidos o recibidos en un rango (máx. 365 días): los tres pasos
   * obligatorios y la descarga del CSV (ZIP), que es lo que se parsea.
   */
  async consultar(origen: OrigenMisComprobantes, desde: Date, hasta: Date, cuitEmpresa: string): Promise<{ filas: FilaMisComprobantes[]; csv: string; idConsulta: string }> {
    const t = origen === 'EMITIDO' ? 'E' : 'R';
    const gen = (await this.ajax('generarConsulta', {
      t,
      fechaEmision: rangoFechasPortal(desde, hasta),
      tiposComprobantes: '',
      cuitConsultada: normalizarCuit(cuitEmpresa),
    })) as { estado?: string; mensajeError?: string; datos?: { idConsulta?: string | number } };
    if (gen.estado !== 'ok' || !gen.datos?.idConsulta) {
      throw new ErrorPortalArca(`generarConsulta falló: ${gen.mensajeError ?? JSON.stringify(gen).slice(0, 200)}`);
    }
    const idConsulta = String(gen.datos.idConsulta);
    await this.ajax('estimarResultados', { id: idConsulta }); // NO saltear: destraba la consulta
    const lista = (await this.ajax('listaResultados', { id: idConsulta })) as { estado?: string; datos?: { data?: unknown[]; consulta?: { error?: unknown } } };
    if (lista.estado && lista.estado !== 'ok') throw new ErrorPortalArca(`listaResultados falló: ${JSON.stringify(lista).slice(0, 200)}`);
    if (lista.datos?.consulta?.error) throw new ErrorPortalArca(`Mis Comprobantes informó un error en la consulta: ${String(lista.datos.consulta.error)}`);
    const cantidadJson = Array.isArray(lista.datos?.data) ? lista.datos!.data!.length : null;

    const csv = await this.descargarCsv(idConsulta, t);
    const parsed = parsearCsvMisComprobantes(csv);
    if (parsed.origen !== origen) throw new ErrorPortalArca(`El CSV descargado es de ${parsed.origen} y se pidió ${origen}.`);
    if (cantidadJson != null && cantidadJson !== parsed.filas.length) {
      throw new ErrorPortalArca(`Mis Comprobantes devolvió ${cantidadJson} filas en el JSON y ${parsed.filas.length} en el CSV.`);
    }
    return { filas: parsed.filas, csv, idConsulta };
  }

  private async descargarCsv(idConsulta: string, tc: 'E' | 'R'): Promise<string> {
    for (let intento = 1; ; intento++) {
      const res = await this.pedir({ method: 'GET', url: `${URL_MCMP}/descargarComprobantes.do?id=${encodeURIComponent(idConsulta)}&tc=${tc}&tf=csv` }, { accept: '*/*' });
      const ct = res.headers['content-type'] ?? '';
      if (res.status === 200 && (/zip/i.test(ct) || (res.body.length > 22 && res.body.readUInt32LE(0) === 0x04034b50))) {
        return extraerCsvDeZip(res.body).contenido;
      }
      const clas = clasificarRespuestaAjax(res.status, ct, this.texto(res));
      if (clas.tipo === 'sesion_vencida') throw new ErrorSesionVencida('La sesión de Mis Comprobantes venció al descargar.');
      if (intento < REINTENTOS_WAF) {
        await dormir(this.pausaMs * 2 * intento);
        continue;
      }
      throw new ErrorPortalArca(`La descarga del CSV no devolvió un ZIP (${clas.tipo === 'waf' ? 'bloqueo del WAF' : `HTTP ${res.status} ${ct}`}).`);
    }
  }

  /** Cierra la sesión del servicio. El endpoint devuelve 404 pero corta la sesión igual. */
  async salir(): Promise<void> {
    try {
      await this.pedir({ method: 'GET', url: `${URL_MCMP}/logout.do` });
    } catch {
      /* best-effort */
    }
  }
}

export type ParametrosDescarga = {
  cuitUsuario: string;
  clave: string;
  cuitEmpresa: string;
  desde: Date;
  hasta: Date;
};

export type ResultadoDescarga = {
  emitidos: FilaMisComprobantes[];
  recibidos: FilaMisComprobantes[];
  csvEmitidos: string;
  csvRecibidos: string;
};

/**
 * Corrida completa: UN login, emitidos y recibidos del rango. Si la sesión
 * vence en el medio (pasa a los ~15 min), re-loguea una única vez: las
 * credenciales ya demostraron ser válidas, así que no es martillar la clave.
 */
export async function descargarMisComprobantes(params: ParametrosDescarga, opts: OpcionesCliente = {}): Promise<ResultadoDescarga> {
  const cliente = new ClientePortalArca(opts);
  await cliente.login(params.cuitUsuario, params.clave);
  await cliente.abrirMisComprobantes(params.cuitEmpresa);
  let relogueado = false;
  const consultar = async (origen: OrigenMisComprobantes) => {
    try {
      return await cliente.consultar(origen, params.desde, params.hasta, params.cuitEmpresa);
    } catch (e) {
      if (!(e instanceof ErrorSesionVencida) || relogueado) throw e;
      relogueado = true;
      await cliente.login(params.cuitUsuario, params.clave);
      await cliente.abrirMisComprobantes(params.cuitEmpresa);
      return cliente.consultar(origen, params.desde, params.hasta, params.cuitEmpresa);
    }
  };
  try {
    const emitidos = await consultar('EMITIDO');
    const recibidos = await consultar('RECIBIDO');
    return { emitidos: emitidos.filas, recibidos: recibidos.filas, csvEmitidos: emitidos.csv, csvRecibidos: recibidos.csv };
  } finally {
    await cliente.salir();
  }
}
