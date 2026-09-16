import { normalizarDescriptor } from './matching';

// Verificación de que un resumen pertenece a la empresa a la que se lo subió:
// se busca el CUIT (con o sin guiones) o la razón social (sin la forma
// jurídica) en la capa de texto del PDF y en el titular que declara la
// extracción (para escaneos, donde el texto lo aporta el LLM).

export type ResultadoVerificacionTitular = 'COINCIDE' | 'NO_COINCIDE' | 'SIN_DATOS';

export type VerificacionTitular = {
  resultado: ResultadoVerificacionTitular;
  /** Titular/CUIT que declaró la extracción, para mostrar el conflicto. */
  titularDetectado: string | null;
};

// Tokens de forma jurídica y conectores que no identifican a la empresa.
const TOKENS_FORMA_JURIDICA = new Set([
  'sa', 'srl', 'sas', 'sca', 'scs', 'sh', 'ltda', 'ltd', 'inc', 'llc',
  'sociedad', 'anonima', 'responsabilidad', 'limitada', 'simplificada', 'acciones', 'colectiva', 'comandita', 'simple', 'hecho',
  'de', 'del', 'la', 'el', 'y', 'e', 'por', 'cia', 'compania',
]);

/** Núcleo identificatorio de la razón social: "Ewwo Consulting S.R.L." → "ewwo consulting". */
export function nombreClaveEmpresa(razonSocial: string): string {
  return normalizarDescriptor(razonSocial)
    .split(' ')
    .filter((t) => t.length > 2 && !TOKENS_FORMA_JURIDICA.has(t))
    .join(' ');
}

const MIN_NOMBRE_CLAVE = 4;
const MIN_TEXTO_VERIFICABLE = 20;

function soloDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/** CUITs que aparecen en el texto, como 11 dígitos: "30-71209348-6", "30 71209348 6" o "30712093486". */
function cuitsEnTexto(texto: string): Set<string> {
  const out = new Set<string>();
  // Sin dígitos pegados a los costados: "9930712093486001" no contiene un CUIT.
  const re = /(?<!\d)(\d{2})[-.\s]?(\d{8})[-.\s]?(\d)(?!\d)/g;
  for (const m of texto.matchAll(re)) out.add(`${m[1]}${m[2]}${m[3]}`);
  return out;
}

export function verificarTitular(params: {
  texto: string | null;
  titularCuenta: string | null;
  cuitTitularCuenta: string | null;
  empresa: { razonSocial: string; cuit: string };
}): VerificacionTitular {
  const texto = params.texto?.trim() || '';
  const titular = params.titularCuenta?.trim() || '';
  const cuitTitular = params.cuitTitularCuenta?.trim() || '';
  const cuitEmpresa = soloDigitos(params.empresa.cuit);
  const nombreClave = nombreClaveEmpresa(params.empresa.razonSocial);

  const titularDetectado = [titular, cuitTitular ? `CUIT ${cuitTitular}` : ''].filter(Boolean).join(' · ') || null;

  // Con qué verificar: texto con algo de contenido (o al menos un CUIT), o
  // un titular declarado. Un escaneo sin nada de eso no se puede juzgar.
  const cuitsTexto = cuitsEnTexto(texto);
  const textoVerificable = texto.length >= MIN_TEXTO_VERIFICABLE || cuitsTexto.size > 0;
  const hayDatos = textoVerificable || titular.length > 0 || cuitTitular.length > 0;
  if (!hayDatos) return { resultado: 'SIN_DATOS', titularDetectado: null };

  const porCuit = cuitEmpresa.length === 11 && (soloDigitos(cuitTitular) === cuitEmpresa || cuitsTexto.has(cuitEmpresa));
  const porNombre =
    nombreClave.length >= MIN_NOMBRE_CLAVE &&
    (normalizarDescriptor(titular).includes(nombreClave) || (texto.length > 0 && normalizarDescriptor(texto).includes(nombreClave)));

  return { resultado: porCuit || porNombre ? 'COINCIDE' : 'NO_COINCIDE', titularDetectado };
}
