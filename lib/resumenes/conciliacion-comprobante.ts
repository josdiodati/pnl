import type { Prisma } from '@prisma/client';
import type { ScopedDb } from '@/lib/empresa/scope';
import { MES_LABEL } from '@/lib/periodos';

// Conciliación de un comprobante con los resúmenes (tarjeta/banco): qué líneas
// lo pagaron y si alcanzan a cubrir el total. Lo muestran el tag «Conciliado»
// de Comprobantes y el bloque del detalle (/validacion/[id]).
//
// Se mide en la moneda del comprobante. Una línea que paga varios comprobantes
// cuenta entera para cada uno (sobrepago = completa, nunca un falso parcial).
// Una línea que no se puede medir (comprobante en USD sin TC pagado en pesos)
// cuenta como cubierta: el vínculo existe y no hay con qué comparar.

export type GradoConciliacion = 'COMPLETA' | 'PARCIAL' | 'NINGUNA';

export type LineaConciliada = {
  id: string;
  resumenId: string;
  resumen: string; // "Visa Galicia · Septiembre 2026"
  fecha: Date | null;
  descriptor: string;
  monto: number | null; // firmado en ARS; null = consumo en moneda extranjera sin pesificar
  moneda: string;
  montoOrigen: number | null;
  cuotas: string | null;
};

export type Conciliacion = {
  grado: GradoConciliacion;
  moneda: string;
  cubierto: number | null; // null = no medible
  faltante: number | null;
  lineas: LineaConciliada[];
};

/** Las líneas que pagan el comprobante: conciliadas o imputadas (el movimiento nació de la línea). */
export const ESTADOS_LINEA_CONCILIADA = ['CONCILIADA', 'IMPUTADA'] as const;

const TOLERANCIA = 0.01; // 1%: redondeos, percepciones, diferencias de centavos

const redondear = (n: number) => Math.round(n * 100) / 100;

function importeEnMonedaDe(comp: { moneda: string; tipoCambio: number | null }, l: LineaConciliada): number | null {
  if (comp.moneda === 'ARS') return l.monto != null ? Math.abs(l.monto) : null;
  if (l.moneda === comp.moneda && l.montoOrigen != null) return Math.abs(l.montoOrigen);
  if (l.monto != null && comp.tipoCambio && comp.tipoCambio > 0) return Math.abs(l.monto) / comp.tipoCambio;
  return null;
}

export function gradoConciliacion(
  comp: { total: number | null; moneda: string; tipoCambio: number | null },
  lineas: LineaConciliada[],
): Conciliacion {
  const base = { moneda: comp.moneda, lineas };
  if (lineas.length === 0) return { ...base, grado: 'NINGUNA', cubierto: 0, faltante: comp.total };
  const importes = lineas.map((l) => importeEnMonedaDe(comp, l));
  if (importes.some((i) => i == null) || comp.total == null) {
    return { ...base, grado: 'COMPLETA', cubierto: null, faltante: null };
  }
  const cubierto = redondear(importes.reduce<number>((s, i) => s + (i ?? 0), 0));
  const total = Math.abs(comp.total);
  if (cubierto >= total * (1 - TOLERANCIA)) return { ...base, grado: 'COMPLETA', cubierto, faltante: 0 };
  return { ...base, grado: 'PARCIAL', cubierto, faltante: redondear(total - cubierto) };
}

const includeLinea = { linea: { include: { resumen: { include: { periodo: true } } } } } as const;
type VinculoConLinea = Prisma.ResumenLineaVinculoGetPayload<{ include: typeof includeLinea }>;

export function lineaConciliada(v: VinculoConLinea): LineaConciliada {
  const { linea } = v;
  const p = linea.resumen.periodo;
  return {
    id: linea.id,
    resumenId: linea.resumenId,
    resumen: `${linea.resumen.emisor} · ${MES_LABEL[p.mes]} ${p.anio}`,
    fecha: linea.fecha,
    descriptor: linea.descriptor,
    monto: linea.monto != null ? Number(linea.monto) : null,
    moneda: linea.moneda,
    montoOrigen: linea.montoOrigen != null ? Number(linea.montoOrigen) : null,
    cuotas: linea.cuotas,
  };
}

type Comp = { id: string; total: unknown; moneda: string; tipoCambio: unknown };

/** Conciliación de varios comprobantes (los de una página) con una sola consulta. */
export async function mapaConciliacion(db: ScopedDb, comps: Comp[]): Promise<Map<string, Conciliacion>> {
  const vinculos = comps.length
    ? await db.resumenLineaVinculo.findMany({
        where: { movimientoId: { in: comps.map((c) => c.id) }, linea: { estado: { in: [...ESTADOS_LINEA_CONCILIADA] } } },
        include: includeLinea,
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const porMov = new Map<string, LineaConciliada[]>();
  for (const v of vinculos) porMov.set(v.movimientoId, [...(porMov.get(v.movimientoId) ?? []), lineaConciliada(v)]);
  return new Map(
    comps.map((c) => [
      c.id,
      gradoConciliacion(
        { total: c.total != null ? Number(c.total) : null, moneda: c.moneda, tipoCambio: c.tipoCambio != null ? Number(c.tipoCambio) : null },
        porMov.get(c.id) ?? [],
      ),
    ]),
  );
}

/**
 * Filtro «Conciliación» de Comprobantes para completa/parcial: ids de los
 * comprobantes con líneas vinculadas y ese grado (ninguna se resuelve en el
 * where, ver buildWhereComprobantes).
 */
export async function idsPorGradoConciliacion(db: ScopedDb, grado: 'COMPLETA' | 'PARCIAL'): Promise<string[]> {
  const conVinculo = await db.resumenLineaVinculo.findMany({
    where: { linea: { estado: { in: [...ESTADOS_LINEA_CONCILIADA] } } },
    select: { movimientoId: true },
    distinct: ['movimientoId'],
  });
  const comps = await db.movimiento.findMany({
    where: { id: { in: conVinculo.map((v) => v.movimientoId) } },
    select: { id: true, total: true, moneda: true, tipoCambio: true },
  });
  const mapa = await mapaConciliacion(db, comps);
  return comps.filter((c) => mapa.get(c.id)?.grado === grado).map((c) => c.id);
}
