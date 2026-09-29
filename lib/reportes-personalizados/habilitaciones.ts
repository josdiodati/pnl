import type { Rol } from '@prisma/client';
import { rolAlcanza } from '@/lib/roles';
import { reporteDelCatalogo } from './catalogo';

// Reglas puras de habilitación de reportes personalizados (sin base).

export type Par = { usuarioId: string; reporteId: string };

/** Ve el reporte si existe en el catálogo, lo tiene habilitado y su rol alcanza el mínimo. */
export function puedeVerReporte(reporteId: string, rol: Rol, habilitados: Set<string>): boolean {
  const r = reporteDelCatalogo(reporteId);
  return Boolean(r && habilitados.has(reporteId) && rolAlcanza(rol, r.rolMinimo));
}

const clave = (p: Par) => `${p.reporteId}\u0000${p.usuarioId}`;

/**
 * Qué crear y qué borrar para pasar de `actual` a `deseado`. Sólo toca pares
 * válidos (= celdas editables de la grilla: reporte en catálogo, miembro de la
 * empresa, rol suficiente). Una fila de un usuario al que le bajaron el rol
 * llega sin marcar (su casilla está deshabilitada) y NO se borra: si le
 * devuelven el rol, recupera el reporte. Las huérfanas tampoco se tocan.
 * Mientras tanto el acceso lo corta puedeVerReporte.
 */
export function diffHabilitaciones(
  actual: Par[],
  deseado: Par[],
  valido: (p: Par) => boolean,
): { altas: Par[]; bajas: Par[] } {
  const hay = new Set(actual.map(clave));
  const quiere = new Set(deseado.map(clave));
  const vistos = new Set<string>();
  const altas: Par[] = [];
  for (const p of deseado) {
    const k = clave(p);
    if (hay.has(k) || vistos.has(k) || !valido(p)) continue;
    vistos.add(k);
    altas.push(p);
  }
  const bajas = actual.filter((p) => !quiere.has(clave(p)) && valido(p));
  return { altas, bajas };
}

/** Lee los checkboxes `h:<reporteId>:<usuarioId>` de la grilla de Configuración. */
export function parsearGrilla(form: FormData): Par[] {
  const pares: Par[] = [];
  for (const [name] of form.entries()) {
    const m = /^h:([^:]+):([^:]+)$/.exec(name);
    if (m) pares.push({ reporteId: m[1], usuarioId: m[2] });
  }
  return pares;
}
