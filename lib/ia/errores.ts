// Clasificación de los errores de la API de Anthropic (extracción de
// comprobantes, resúmenes y recibos) en códigos con nombre propio.
//
// El alcance decide qué hace el worker:
//   GLOBAL      la cuenta o la configuración no permiten usar la API (sin
//               crédito, clave revocada, modelo retirado…): ningún documento
//               va a poder procesarse. Se abre una alerta y el job queda en
//               espera SIN gastar intentos, hasta que se resuelva.
//   TRANSITORIO la API está saturada o no hay red: backoff normal; si se
//               agotan los intentos, alerta.
//   DOCUMENTO   la API rechazó ESTE archivo: el documento queda con error.

export type CodigoErrorIa =
  | 'SIN_CLAVE'
  | 'SIN_CREDITO'
  | 'LIMITE_GASTO'
  | 'CLAVE_INVALIDA'
  | 'SIN_PERMISO'
  | 'MODELO_INEXISTENTE'
  | 'LIMITE_VELOCIDAD'
  | 'API_SOBRECARGADA'
  | 'ERROR_INTERNO_API'
  | 'SIN_CONEXION'
  | 'DOCUMENTO_RECHAZADO';

export type AlcanceErrorIa = 'GLOBAL' | 'TRANSITORIO' | 'DOCUMENTO';

export type ErrorIa = {
  codigo: CodigoErrorIa;
  alcance: AlcanceErrorIa;
  titulo: string;
  /** Qué hacer para resolverlo. */
  accion: string;
  status: number | null;
  tipoApi: string | null;
  mensajeApi: string;
  requestId: string | null;
};

export const DESCRIPCION_ERROR_IA: Record<CodigoErrorIa, { alcance: AlcanceErrorIa; titulo: string; accion: string }> = {
  SIN_CLAVE: {
    alcance: 'GLOBAL',
    titulo: 'Falta la API key de Anthropic',
    accion: 'EXTRACTOR_MODE=real pero ANTHROPIC_API_KEY está vacía: se está usando el extractor de prueba y los datos NO son reales. Cargá la clave en el .env del servidor y reiniciá pnl-worker.',
  },
  SIN_CREDITO: {
    alcance: 'GLOBAL',
    titulo: 'Sin crédito en la cuenta de Anthropic',
    accion: 'Cargá crédito en console.anthropic.com → Settings → Billing (conviene activar la recarga automática).',
  },
  LIMITE_GASTO: {
    alcance: 'GLOBAL',
    titulo: 'Se alcanzó el límite de gasto de la API',
    accion: 'Subí el límite en console.anthropic.com → Settings → Limits, o esperá a la fecha que indica el mensaje.',
  },
  CLAVE_INVALIDA: {
    alcance: 'GLOBAL',
    titulo: 'API key de Anthropic inválida o revocada',
    accion: 'Generá una clave nueva en console.anthropic.com → API Keys, cargala en ANTHROPIC_API_KEY del .env del servidor y reiniciá pnl-worker.',
  },
  SIN_PERMISO: {
    alcance: 'GLOBAL',
    titulo: 'La API key no tiene permiso para esta operación',
    accion: 'Revisá en console.anthropic.com el workspace y los permisos de la clave.',
  },
  MODELO_INEXISTENTE: {
    alcance: 'GLOBAL',
    titulo: 'El modelo configurado no existe o fue retirado',
    accion: 'Cambiá EXTRACTOR_MODEL en el .env del servidor por un modelo vigente y reiniciá pnl-worker.',
  },
  LIMITE_VELOCIDAD: {
    alcance: 'TRANSITORIO',
    titulo: 'Límite de velocidad de la API (demasiados pedidos por minuto)',
    accion: 'Se reintenta solo. Si se repite, subí el nivel de uso (tier) de la cuenta en console.anthropic.com.',
  },
  API_SOBRECARGADA: {
    alcance: 'TRANSITORIO',
    titulo: 'La API de Anthropic está sobrecargada',
    accion: 'Es un problema del lado de Anthropic; se reintenta solo. Ver status.anthropic.com.',
  },
  ERROR_INTERNO_API: {
    alcance: 'TRANSITORIO',
    titulo: 'Error interno de la API de Anthropic',
    accion: 'Es un problema del lado de Anthropic; se reintenta solo. Ver status.anthropic.com.',
  },
  SIN_CONEXION: {
    alcance: 'TRANSITORIO',
    titulo: 'Sin conexión con la API de Anthropic',
    accion: 'Revisá la salida a internet del servidor (puerto 443 hacia api.anthropic.com).',
  },
  DOCUMENTO_RECHAZADO: {
    alcance: 'DOCUMENTO',
    titulo: 'La API rechazó este documento',
    accion: 'Revisá el archivo (dañado, protegido o demasiado grande) y volvé a subirlo.',
  },
};

type ErrorApiLike = {
  status?: unknown;
  error?: { error?: { type?: unknown; message?: unknown } } | unknown;
  request_id?: unknown;
  message?: unknown;
  name?: unknown;
};

function construir(codigo: CodigoErrorIa, e: ErrorApiLike, status: number | null, tipoApi: string | null, mensajeApi: string): ErrorIa {
  const d = DESCRIPCION_ERROR_IA[codigo];
  return {
    codigo,
    alcance: d.alcance,
    titulo: d.titulo,
    accion: d.accion,
    status,
    tipoApi,
    mensajeApi,
    requestId: typeof e.request_id === 'string' ? e.request_id : null,
  };
}

/**
 * Clasifica un error lanzado por el SDK de Anthropic. Devuelve null si no es
 * un error de la API (un bug nuestro, un archivo faltante…). Se compara por
 * forma y no por `instanceof` para no depender de la versión del SDK.
 */
export function clasificarErrorIa(err: unknown): ErrorIa | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as ErrorApiLike;
  const nombre = `${typeof e.name === 'string' ? e.name : ''} ${(err as object).constructor?.name ?? ''}`;
  const cuerpo = (e.error as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
  const tipoApi = typeof cuerpo?.type === 'string' ? cuerpo.type : null;
  const mensajeApi = typeof cuerpo?.message === 'string' ? cuerpo.message : typeof e.message === 'string' ? e.message : String(err);
  const status = typeof e.status === 'number' ? e.status : null;

  if (status === null) {
    return /APIConnection(Timeout)?Error/.test(nombre) ? construir('SIN_CONEXION', e, null, tipoApi, mensajeApi) : null;
  }
  if (!('error' in e) && !('request_id' in e)) return null; // tiene status pero no es de la API

  if (status === 400 && /credit balance/i.test(mensajeApi)) return construir('SIN_CREDITO', e, status, tipoApi, mensajeApi);
  if (status === 400 && /usage limit|spend limit|spending limit/i.test(mensajeApi)) return construir('LIMITE_GASTO', e, status, tipoApi, mensajeApi);
  if (status === 401) return construir('CLAVE_INVALIDA', e, status, tipoApi, mensajeApi);
  if (status === 403) return construir('SIN_PERMISO', e, status, tipoApi, mensajeApi);
  if (status === 404) return construir('MODELO_INEXISTENTE', e, status, tipoApi, mensajeApi);
  if (status === 429) return construir('LIMITE_VELOCIDAD', e, status, tipoApi, mensajeApi);
  if (status === 529 || tipoApi === 'overloaded_error') return construir('API_SOBRECARGADA', e, status, tipoApi, mensajeApi);
  if (status >= 500) return construir('ERROR_INTERNO_API', e, status, tipoApi, mensajeApi);
  return construir('DOCUMENTO_RECHAZADO', e, status, tipoApi, mensajeApi);
}

/** Texto para guardar en el job / documento: nombre del error primero, lo crudo después. */
export function mensajeErrorIa(e: ErrorIa): string {
  const partes = [`[${e.codigo}] ${e.titulo}.`, `API: ${e.status ?? 'sin respuesta'}${e.tipoApi ? ` ${e.tipoApi}` : ''} — ${e.mensajeApi}`];
  if (e.requestId) partes.push(`request_id ${e.requestId}`);
  return partes.join(' ');
}
