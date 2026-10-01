import { importesPorLinea } from '@/lib/movimientos/distribucion';
import { correspondeAlMes } from '@/lib/empleados/mes';
import { baseImponibleFirmada, type MesPnl, type MovimientoPnl } from './pnl';

// Prorrateo de centros de costo (Reporte P&L, vista por centro). Un centro
// marcado prorrateable reparte su resultado del mes a los demás según un
// driver — headcount o facturación —, por el MÉTODO DIRECTO: los centros
// prorrateables nunca reciben y su driver no cuenta en el denominador (sin
// ciclos ni orden). Ej. Ewwo sep-2026: 13 cabezas, Seat Cost 1 → base 12,
// BPO (7) recibe 7/12. Es capa de reporte: no genera asientos.
// Diseño: docs/superpowers/specs/2026-10-01-prorrateo-centros-de-costo-design.md

export type CriterioProrrateo = 'HEADCOUNT' | 'FACTURACION';
export const CRITERIO_LABEL: Record<CriterioProrrateo, string> = { HEADCOUNT: 'headcount', FACTURACION: 'facturación' };

export type LineaCentro = { centroCostoId: string; porcentaje: number };
/** Recibo MENSUAL CONFIRMADO (sólo esos cuentan cabezas). */
export type ReciboHeadcount = { empleadoId: string; anio: number; mes: number; lineas: LineaCentro[] };
export type EmpleadoHeadcount = {
  id: string;
  activo: boolean;
  fechaIngreso: Date | null;
  fechaEgreso: Date | null;
  /** Asignación permanente (ficha): rige el mes que aún no tiene recibo confirmado. */
  ficha: LineaCentro[];
};

const clave = (anio: number, mes: number) => `${anio}-${mes}`;

function correspondeFicha(e: EmpleadoHeadcount, anio: number, mes: number): boolean {
  if (!e.activo && !e.fechaEgreso) return false; // dado de baja sin fecha: no hay mes en que rija
  if (e.fechaIngreso && e.fechaIngreso.getUTCFullYear() * 12 + e.fechaIngreso.getUTCMonth() > anio * 12 + (mes - 1)) return false;
  return correspondeAlMes(e, anio, mes);
}

/**
 * Headcount ponderado por centro y mes: por empleado, la distribución de su
 * recibo mensual confirmado del mes; si no lo tiene, la de su ficha (mientras
 * corresponda al mes). Una persona 60/40 suma 0,6 y 0,4.
 */
export function headcountPorCentro(input: {
  meses: MesPnl[];
  recibos: ReciboHeadcount[];
  empleados: EmpleadoHeadcount[];
}): Map<string, number[]> {
  const N = input.meses.length;
  const hc = new Map<string, number[]>();
  const sumar = (lineas: LineaCentro[], c: number) => {
    for (const l of lineas) {
      if (!hc.has(l.centroCostoId)) hc.set(l.centroCostoId, Array<number>(N).fill(0));
      hc.get(l.centroCostoId)![c] += l.porcentaje / 100;
    }
  };
  const reciboDe = new Map<string, LineaCentro[]>();
  for (const r of input.recibos) if (r.lineas.length) reciboDe.set(`${r.empleadoId}|${clave(r.anio, r.mes)}`, r.lineas);
  const ids = new Set([...input.empleados.map((e) => e.id), ...input.recibos.map((r) => r.empleadoId)]);
  const empleadoPorId = new Map(input.empleados.map((e) => [e.id, e]));

  input.meses.forEach((m, c) => {
    for (const id of ids) {
      const delRecibo = reciboDe.get(`${id}|${clave(m.anio, m.mes)}`);
      if (delRecibo) {
        sumar(delRecibo, c);
        continue;
      }
      const e = empleadoPorId.get(id);
      if (e?.ficha.length && correspondeFicha(e, m.anio, m.mes)) sumar(e.ficha, c);
    }
  });
  return hc;
}

/** Facturación neta (centavos ARS) por centro y mes: ventas asignadas repartidas por sus líneas. */
export function facturacionPorCentro(input: { meses: MesPnl[]; movimientos: MovimientoPnl[] }): Map<string, number[]> {
  const N = input.meses.length;
  const col = new Map(input.meses.map((m, i) => [clave(m.anio, m.mes), i]));
  const f = new Map<string, number[]>();
  for (const mov of input.movimientos) {
    if (mov.tipoCategoria !== 'INGRESO' || mov.esImpuestoIndirecto || !mov.lineas?.length) continue;
    const c = col.get(clave(mov.anio, mov.mes));
    if (c == null) continue;
    const base = baseImponibleFirmada(mov);
    if (base == null) continue;
    let importes: number[];
    try {
      importes = importesPorLinea(base, mov.lineas);
    } catch {
      continue; // líneas inconsistentes: no aportan al driver
    }
    mov.lineas.forEach((l, i) => {
      if (!f.has(l.centroCostoId)) f.set(l.centroCostoId, Array<number>(N).fill(0));
      f.get(l.centroCostoId)![c] += importes[i];
    });
  }
  return f;
}

/**
 * Reparte `total` centavos proporcional a `pesos` (≥ 0, suma > 0) por mayor
 * resto: las partes suman exactamente el total y llevan su signo.
 */
export function repartirProporcional(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, p) => a + p, 0);
  const abs = Math.abs(total);
  const exactas = pesos.map((p) => (abs * p) / suma);
  const partes = exactas.map(Math.floor);
  let resto = abs - partes.reduce((a, v) => a + v, 0);
  const orden = exactas.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of orden) {
    if (resto <= 0) break;
    partes[i] += 1;
    resto -= 1;
  }
  return partes.map((v) => (total < 0 ? -v : v));
}

export type CentroProrrateo = { id: string; prorrateo: CriterioProrrateo | null };

export type Prorrateos = {
  /** receptor → emisor → centavos recibidos por mes (mismo signo que el resultado del emisor). */
  recibidos: Map<string, Map<string, number[]>>;
  /** emisor → ajuste a su resultado por mes (−lo repartido); 0 en los meses sin base. */
  repartido: Map<string, number[]>;
  /** emisor → driver de cada receptor y total del denominador, por mes (para mostrar la fracción). */
  base: Map<string, { porReceptor: Map<string, number[]>; total: number[] }>;
  /** emisor → meses con resultado ≠ 0 pero driver total 0 (no se repartió). */
  sinBase: Map<string, boolean[]>;
};

export function calcularProrrateos(input: {
  meses: MesPnl[];
  centros: CentroProrrateo[];
  /** Resultado del mes de cada centro prorrateable en la vista por centro (centavos). */
  resultadoEmisor: Map<string, number[]>;
  drivers: Record<CriterioProrrateo, Map<string, number[]>>;
}): Prorrateos {
  const N = input.meses.length;
  const out: Prorrateos = { recibidos: new Map(), repartido: new Map(), base: new Map(), sinBase: new Map() };
  const receptores = input.centros.filter((c) => !c.prorrateo).map((c) => c.id);

  for (const emisor of input.centros) {
    if (!emisor.prorrateo) continue;
    const resultado = input.resultadoEmisor.get(emisor.id) ?? Array<number>(N).fill(0);
    const driver = input.drivers[emisor.prorrateo];
    const porReceptor = new Map(receptores.map((r) => [r, (driver.get(r) ?? Array<number>(N).fill(0)).map((v) => Math.max(v, 0))]));
    const total = Array.from({ length: N }, (_, c) => receptores.reduce((a, r) => a + porReceptor.get(r)![c], 0));
    const repartido = Array<number>(N).fill(0);
    const sinBase = Array<boolean>(N).fill(false);

    for (let c = 0; c < N; c++) {
      const monto = resultado[c];
      if (monto === 0) continue;
      if (!(total[c] > 0)) {
        sinBase[c] = true;
        continue;
      }
      const conDriver = receptores.filter((r) => porReceptor.get(r)![c] > 0);
      const partes = repartirProporcional(monto, conDriver.map((r) => porReceptor.get(r)![c]));
      conDriver.forEach((r, i) => {
        if (partes[i] === 0) return;
        if (!out.recibidos.has(r)) out.recibidos.set(r, new Map());
        const delReceptor = out.recibidos.get(r)!;
        if (!delReceptor.has(emisor.id)) delReceptor.set(emisor.id, Array<number>(N).fill(0));
        delReceptor.get(emisor.id)![c] += partes[i];
      });
      repartido[c] = -monto;
    }
    out.repartido.set(emisor.id, repartido);
    out.base.set(emisor.id, { porReceptor, total });
    out.sinBase.set(emisor.id, sinBase);
  }
  return out;
}
