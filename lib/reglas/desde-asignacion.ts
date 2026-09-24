import type { ReglaAsignacion } from '@prisma/client';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';
import { normalizarCuit } from '@/lib/checks';

// Camino inverso a lib/reglas/aplicar.ts: convierte una asignación concreta en
// una regla reutilizable, para que el próximo comprobante del mismo emisor se
// impute solo.
//
// La restricción del modelo manda: ReglaAsignacion guarda un centro único al
// 100% O una plantilla de distribución — nunca líneas sueltas. Un reparto que no
// esté representado por una plantilla existente no se puede volver regla; se
// avisa en vez de inventar un maestro por atrás.

export type PlantillaConLineas = { id: string; lineas: LineaDistribucion[] };

export type EntradaReglaDesdeAsignacion = {
  cuit: string | null;
  razonSocial: string | null;
  categoriaId: string;
  categoriaNombre: string;
  palabraClave: string | null;
  /** Fuente (canal de ingreso) y usuario que cargó: condiciones extra
   *  opcionales. Sin ellas la regla no las evalúa. */
  canal?: string | null;
  cargadoPorId?: string | null;
  /** Nombre del usuario elegido, sólo para el nombre por defecto de la regla. */
  nombreUsuario?: string | null;
  nombrePropuesto: string | null;
  lineas: LineaDistribucion[];
  plantillas: PlantillaConLineas[];
};

export type ReglaNueva = {
  nombre: string;
  cuit: string | null;
  palabraClave: string | null;
  canal: string | null;
  cargadoPorId: string | null;
  categoriaId: string;
  distribucionId: string | null;
  centroCostoId: string | null;
  clienteId: string | null;
  proyectoId: string | null;
};

export type DecisionReglaDesdeAsignacion =
  | { crear: false; motivo: string }
  | { crear: true; regla: ReglaNueva };

function limpiar(v: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Clave estable de una línea, para comparar repartos sin depender del orden. */
function claveLinea(l: LineaDistribucion): string {
  return [l.centroCostoId, l.clienteId ?? '', l.proyectoId ?? '', Number(l.porcentaje)].join('|');
}

function claveReparto(lineas: LineaDistribucion[]): string {
  return lineas.map(claveLinea).sort().join('||');
}

/** Regla de imputación ya vigente para ese CUIT, o null.
 *  Las de acción OBSERVAR quedan afuera: son descartes, no una imputación que
 *  tenga sentido pisar con la asignación que se está cargando. */
export function reglaVigenteParaCuit<T extends Pick<ReglaAsignacion, 'cuit' | 'accion'>>(
  reglas: T[],
  cuit: string | null,
): T | null {
  const objetivo = cuit ? normalizarCuit(cuit) : null;
  if (!objetivo) return null;
  return reglas.find((r) => r.accion === 'ASIGNAR' && r.cuit && normalizarCuit(r.cuit) === objetivo) ?? null;
}

/** Regla de imputación sin CUIT con la misma palabra clave, o null. Es la que
 *  se pisa al crear una regla desde un comprobante sin CUIT; las que además
 *  tienen CUIT se pisan por CUIT y quedan afuera. */
export function reglaVigenteParaPalabraClave<T extends Pick<ReglaAsignacion, 'cuit' | 'palabraClave' | 'accion'>>(
  reglas: T[],
  palabraClave: string | null,
): T | null {
  const objetivo = limpiar(palabraClave)?.toLowerCase();
  if (!objetivo) return null;
  return (
    reglas.find(
      (r) => r.accion === 'ASIGNAR' && !r.cuit && r.palabraClave?.trim().toLowerCase() === objetivo,
    ) ?? null
  );
}

/** Fuentes (canales de ingreso) elegibles como condición. */
export const CANALES_REGLA = ['WEB', 'FOTO', 'EMAIL', 'TELEGRAM', 'MANUAL'] as const;
export const CANAL_LABEL: Record<string, string> = { WEB: 'Web', FOTO: 'Foto', EMAIL: 'Email', TELEGRAM: 'Telegram', MANUAL: 'Carga manual' };

/** El canal tal como vino del form, o null si no es uno conocido. */
export function canalRegla(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (CANALES_REGLA as readonly string[]).includes(t) ? t : null;
}

type CondicionesRegla = { cuit: string | null; palabraClave: string | null; canal: string | null; cargadoPorId: string | null };

function mismaPalabra(a: string | null | undefined, b: string | null | undefined): boolean {
  return (limpiar(a ?? null)?.toLowerCase() ?? null) === (limpiar(b ?? null)?.toLowerCase() ?? null);
}

/** Todas las reglas de imputación (ASIGNAR) del CUIT, en el orden en que el
 *  motor las evalúa. Para el aviso del atajo: un CUIT puede tener varias. */
export function reglasDelCuit<T extends Pick<ReglaAsignacion, 'cuit' | 'accion' | 'prioridad'>>(reglas: T[], cuit: string | null): T[] {
  const objetivo = cuit ? normalizarCuit(cuit) : null;
  if (!objetivo) return [];
  return reglas
    .filter((r) => r.accion === 'ASIGNAR' && r.cuit && normalizarCuit(r.cuit) === objetivo)
    .sort((a, b) => a.prioridad - b.prioridad);
}

/** Texto corto de las condiciones extra de una regla (además del CUIT). */
export function describirCondiciones(
  r: Pick<ReglaAsignacion, 'palabraClave' | 'canal' | 'cargadoPorId'>,
  nombresUsuarios: Map<string, string>,
): string {
  const partes: string[] = [];
  if (limpiar(r.palabraClave)) partes.push(`dice «${r.palabraClave!.trim()}»`);
  if (r.canal) partes.push(`fuente ${CANAL_LABEL[r.canal] ?? r.canal}`);
  if (r.cargadoPorId) partes.push(`usuario ${nombresUsuarios.get(r.cargadoPorId) ?? r.cargadoPorId}`);
  return partes.length ? partes.join(' · ') : 'sin condiciones extra';
}

/** Regla de imputación con EXACTAMENTE las mismas condiciones que la nueva:
 *  mismo CUIT (o, sin CUIT, misma palabra clave), misma palabra clave, misma
 *  fuente y mismo usuario. Es la única que se pisa al guardar desde el atajo.
 *  Cualquier diferencia es otra regla: un CUIT puede tener varias, según lo
 *  que diga el OCR, la fuente o quién lo cargue. */
export function reglaEquivalente<T extends Pick<ReglaAsignacion, 'cuit' | 'palabraClave' | 'canal' | 'cargadoPorId' | 'accion'>>(
  reglas: T[],
  nueva: CondicionesRegla,
): T | null {
  const cuit = nueva.cuit ? normalizarCuit(nueva.cuit) : null;
  if (!cuit && !limpiar(nueva.palabraClave)) return null;
  return (
    reglas.find((r) => {
      if (r.accion !== 'ASIGNAR') return false;
      if ((r.canal ?? null) !== (nueva.canal ?? null)) return false;
      if ((r.cargadoPorId ?? null) !== (nueva.cargadoPorId ?? null)) return false;
      if (!mismaPalabra(r.palabraClave, nueva.palabraClave)) return false;
      if (cuit) return !!r.cuit && normalizarCuit(r.cuit) === cuit;
      return !r.cuit;
    }) ?? null
  );
}

/** Prioridad para una regla nueva con condiciones extra (palabra clave, fuente,
 *  usuario), de modo que se evalúe ANTES que todas las reglas menos específicas
 *  del mismo CUIT (o, sin CUIT, de la misma palabra clave): el motor toma la
 *  primera que matchea y una regla amplia matchearía siempre. Null si no hay
 *  nada que adelantar (queda la prioridad por defecto). */
export function prioridadParaEspecifica<T extends Pick<ReglaAsignacion, 'cuit' | 'palabraClave' | 'canal' | 'cargadoPorId' | 'accion' | 'prioridad'>>(
  reglas: T[],
  nueva: CondicionesRegla,
): number | null {
  const cuit = nueva.cuit ? normalizarCuit(nueva.cuit) : null;
  const palabra = limpiar(nueva.palabraClave);
  const extras = [cuit ? palabra : null, nueva.canal, nueva.cargadoPorId].filter(Boolean).length;
  if (extras === 0) return null;
  const menosEspecificas = reglas.filter((r) => {
    if (r.accion !== 'ASIGNAR') return false;
    if (cuit ? !(r.cuit && normalizarCuit(r.cuit) === cuit) : !(!r.cuit && mismaPalabra(r.palabraClave, palabra))) return false;
    // cada condición de r tiene que estar también en la nueva (subconjunto)...
    if (cuit && limpiar(r.palabraClave) && !mismaPalabra(r.palabraClave, palabra)) return false;
    if (r.canal && r.canal !== nueva.canal) return false;
    if (r.cargadoPorId && r.cargadoPorId !== nueva.cargadoPorId) return false;
    // ...y r tiene que tener estrictamente menos
    const suyas = [cuit ? limpiar(r.palabraClave) : null, r.canal, r.cargadoPorId].filter(Boolean).length;
    return suyas < extras;
  });
  if (menosEspecificas.length === 0) return null;
  return Math.min(...menosEspecificas.map((r) => r.prioridad)) - 10;
}

/** Id de la plantilla cuyas líneas son exactamente este reparto, o null. */
export function plantillaQueCoincide(lineas: LineaDistribucion[], plantillas: PlantillaConLineas[]): string | null {
  const objetivo = claveReparto(lineas);
  return plantillas.find((p) => claveReparto(p.lineas) === objetivo)?.id ?? null;
}

export function construirReglaDesdeAsignacion(e: EntradaReglaDesdeAsignacion): DecisionReglaDesdeAsignacion {
  const cuit = limpiar(e.cuit);
  const palabraClave = limpiar(e.palabraClave);
  // Sin CUIT la palabra clave es la única condición posible (el matching ya la
  // soporta sola; una regla sin ninguna condición no matchea nunca).
  if (!cuit && !palabraClave)
    return { crear: false, motivo: 'el comprobante no tiene CUIT: cargá una palabra clave, es la única condición posible' };
  if (e.lineas.length === 0) return { crear: false, motivo: 'la asignación no tiene líneas' };

  const canal = limpiar(e.canal ?? null);
  const cargadoPorId = limpiar(e.cargadoPorId ?? null);
  // Con CUIT, las condiciones extra van al nombre: dos reglas del mismo emisor
  // no pueden llamarse igual (unique por empresa) y así se distinguen a simple vista.
  const extras = cuit ? [palabraClave, canal ? (CANAL_LABEL[canal] ?? canal) : null, e.nombreUsuario ?? null].filter(Boolean) : [];
  const sujeto = limpiar(e.razonSocial) ?? cuit ?? palabraClave;
  const nombre =
    limpiar(e.nombrePropuesto) ?? `${sujeto}${extras.length ? ` (${extras.join(', ')})` : ''} → ${e.categoriaNombre}`;

  const comun = {
    nombre,
    cuit,
    palabraClave,
    canal,
    cargadoPorId,
    categoriaId: e.categoriaId,
  };

  const [unica] = e.lineas;
  if (e.lineas.length === 1 && Number(unica.porcentaje) === 100) {
    return {
      crear: true,
      regla: {
        ...comun,
        distribucionId: null,
        centroCostoId: unica.centroCostoId,
        clienteId: unica.clienteId ?? null,
        proyectoId: unica.proyectoId ?? null,
      },
    };
  }

  const distribucionId = plantillaQueCoincide(e.lineas, e.plantillas);
  if (!distribucionId) {
    return {
      crear: false,
      motivo: 'el reparto no coincide con ninguna plantilla de distribución: guardalo como plantilla en Maestros → Distribuciones y volvé a intentarlo',
    };
  }

  return {
    crear: true,
    regla: { ...comun, distribucionId, centroCostoId: null, clienteId: null, proyectoId: null },
  };
}
