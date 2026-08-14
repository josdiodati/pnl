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
  nombrePropuesto: string | null;
  lineas: LineaDistribucion[];
  plantillas: PlantillaConLineas[];
};

export type ReglaNueva = {
  nombre: string;
  cuit: string;
  palabraClave: string | null;
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

/** Id de la plantilla cuyas líneas son exactamente este reparto, o null. */
export function plantillaQueCoincide(lineas: LineaDistribucion[], plantillas: PlantillaConLineas[]): string | null {
  const objetivo = claveReparto(lineas);
  return plantillas.find((p) => claveReparto(p.lineas) === objetivo)?.id ?? null;
}

export function construirReglaDesdeAsignacion(e: EntradaReglaDesdeAsignacion): DecisionReglaDesdeAsignacion {
  const cuit = limpiar(e.cuit);
  if (!cuit) return { crear: false, motivo: 'el comprobante no tiene CUIT: no hay condición para la regla' };
  if (e.lineas.length === 0) return { crear: false, motivo: 'la asignación no tiene líneas' };

  const nombre =
    limpiar(e.nombrePropuesto) ?? `${limpiar(e.razonSocial) ?? cuit} → ${e.categoriaNombre}`;

  const comun = {
    nombre,
    cuit,
    palabraClave: limpiar(e.palabraClave),
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
