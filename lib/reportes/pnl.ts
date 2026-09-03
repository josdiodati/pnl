import { signoMovimiento } from '@/lib/movimientos/signo';
import { importesPorLinea } from '@/lib/movimientos/distribucion';

// P&L por categoría × mes del ejercicio. SOLO los montos netos computan el
// resultado: base = total − IVA − percepciones − otros tributos (funciona
// igual para comprobantes con desglose y asientos sin él), × TC si la moneda
// es extranjera. Los impuestos indirectos quedan como MEMO bajo el resultado
// (no lo modifican): IVA débito/crédito y posición, percepciones, tributos.
//
// Con `proyecto` la misma tabla muestra la porción de un proyecto (o de las
// líneas sin proyecto, proyectoId null), tomada de las líneas de distribución
// con el reparto al centavo sobre la MISMA base neta: la suma de todos los
// proyectos + "sin proyecto" reproduce exactamente el total sin filtro.

export type MesPnl = { anio: number; mes: number };

export type LineaPnl = { centroCostoId: string; proyectoId?: string | null; porcentaje: number };

export type MovimientoPnl = {
  anio: number;
  mes: number;
  categoriaId: string | null;
  tipoCategoria: 'INGRESO' | 'EGRESO';
  esCostoPersonal: boolean;
  tipoComprobante: string | null;
  moneda: string;
  tipoCambio: number | null;
  total: number | null;
  iva21: number | null;
  iva105: number | null;
  iva27: number | null;
  percepcionesIva: number | null;
  percepcionesIibb: number | null;
  otrosTributos: number | null;
  lineas?: LineaPnl[];
};

export type ReciboPnl = { anio: number; mes: number; costoTotalEmpleador: number | null; lineas?: LineaPnl[] };

export type FiltroProyecto = { proyectoId: string | null }; // null = líneas sin proyecto

const n = (v: number | null | undefined) => v ?? 0;

/** Base imponible firmada en centavos ARS; null si falta total o TC. */
export function baseImponibleFirmada(mov: MovimientoPnl): number | null {
  if (mov.total == null) return null;
  let tc = 1;
  if (mov.moneda !== 'ARS') {
    if (!mov.tipoCambio || !(mov.tipoCambio > 0)) return null;
    tc = mov.tipoCambio;
  }
  const neto =
    mov.total - n(mov.iva21) - n(mov.iva105) - n(mov.iva27) - n(mov.percepcionesIva) - n(mov.percepcionesIibb) - n(mov.otrosTributos);
  return signoMovimiento(mov.tipoCategoria, mov.tipoComprobante) * Math.round(neto * tc * 100);
}

/** Componente de impuesto firmado (mismo signo/TC que la base). */
function impuestoFirmado(mov: MovimientoPnl, importe: number | null): number {
  if (importe == null || mov.total == null) return 0;
  let tc = 1;
  if (mov.moneda !== 'ARS') {
    if (!mov.tipoCambio || !(mov.tipoCambio > 0)) return 0;
    tc = mov.tipoCambio;
  }
  return signoMovimiento(mov.tipoCategoria, mov.tipoComprobante) * Math.round(importe * tc * 100);
}

export type MemoImpuestos = {
  ivaDebito: number[]; // IVA de ingresos (ventas)
  ivaCredito: number[]; // IVA de egresos (compras), negativo
  posicionIva: number[]; // débito + crédito
  percepcionesIva: number[];
  percepcionesIibb: number[];
  otrosTributos: number[];
};

export type Pnl = {
  meses: MesPnl[];
  ingresos: Map<string, number[]>; // por categoría INGRESO
  egresos: Map<string, number[]>; // por categoría EGRESO (no personal)
  personal: Map<string, number[]>; // categorías esCostoPersonal (ej. Prepagas)
  sueldos: number[]; // recibos confirmados (costo total empleador), negativo
  sinCategoria: number[]; // asignados sin categoría computable (no debería haber)
  sinDistribucion: number[]; // sólo en la vista "sin proyecto": líneas ausentes/inconsistentes (revisar)
  subtotalIngresos: number[];
  subtotalEgresos: number[];
  subtotalPersonal: number[];
  resultado: number[];
  memo: MemoImpuestos;
  totalEjercicio: { resultado: number };
};

/**
 * Porción de un total firmado que corresponde al proyecto (o a "sin proyecto"
 * con proyectoId null), al centavo. Devuelve null si las líneas faltan o son
 * inconsistentes: quién llama decide qué hacer con lo no distribuible.
 */
function parteDelProyecto(totalCentavos: number, lineas: LineaPnl[] | undefined, proyectoId: string | null): number | null {
  if (!lineas?.length) return null;
  try {
    const importes = importesPorLinea(totalCentavos, lineas);
    return lineas.reduce((acc, l, i) => acc + ((l.proyectoId ?? null) === proyectoId ? importes[i] : 0), 0);
  } catch {
    return null;
  }
}

export function armarPnl(input: {
  meses: MesPnl[];
  movimientos: MovimientoPnl[];
  recibos: ReciboPnl[];
  proyecto?: FiltroProyecto;
}): Pnl {
  const N = input.meses.length;
  const col = new Map(input.meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const ceros = () => Array<number>(N).fill(0);
  const filtro = input.proyecto;

  const pnl: Pnl = {
    meses: input.meses,
    ingresos: new Map(),
    egresos: new Map(),
    personal: new Map(),
    sueldos: ceros(),
    sinCategoria: ceros(),
    sinDistribucion: ceros(),
    subtotalIngresos: ceros(),
    subtotalEgresos: ceros(),
    subtotalPersonal: ceros(),
    resultado: ceros(),
    memo: {
      ivaDebito: ceros(),
      ivaCredito: ceros(),
      posicionIva: ceros(),
      percepcionesIva: ceros(),
      percepcionesIibb: ceros(),
      otrosTributos: ceros(),
    },
    totalEjercicio: { resultado: 0 },
  };

  const sumarEn = (mapa: Map<string, number[]>, clave: string, c: number, v: number) => {
    if (!mapa.has(clave)) mapa.set(clave, ceros());
    mapa.get(clave)![c] += v;
  };

  for (const mov of input.movimientos) {
    const c = col.get(`${mov.anio}-${mov.mes}`);
    if (c == null) continue;
    const base = baseImponibleFirmada(mov);
    if (base == null) continue;

    let importe = base;
    if (filtro) {
      const parte = parteDelProyecto(base, mov.lineas, filtro.proyectoId);
      if (parte == null) {
        // No distribuible: sólo la vista "sin proyecto" lo muestra, como fila
        // aparte a revisar — así la suma por proyectos sigue cerrando.
        if (filtro.proyectoId === null) pnl.sinDistribucion[c] += base;
        continue;
      }
      importe = parte;
    }

    if (!mov.categoriaId) {
      pnl.sinCategoria[c] += importe;
    } else if (mov.esCostoPersonal) {
      sumarEn(pnl.personal, mov.categoriaId, c, importe);
    } else if (mov.tipoCategoria === 'INGRESO') {
      sumarEn(pnl.ingresos, mov.categoriaId, c, importe);
    } else {
      sumarEn(pnl.egresos, mov.categoriaId, c, importe);
    }

    // Memo de impuestos indirectos (bajo el resultado, no lo modifican). El
    // IVA es del comprobante, no de la línea: con filtro por proyecto se omite.
    if (filtro) continue;
    const iva = impuestoFirmado(mov, n(mov.iva21) + n(mov.iva105) + n(mov.iva27) || null);
    if (mov.tipoCategoria === 'INGRESO') pnl.memo.ivaDebito[c] += iva;
    else pnl.memo.ivaCredito[c] += iva;
    pnl.memo.percepcionesIva[c] += impuestoFirmado(mov, mov.percepcionesIva);
    pnl.memo.percepcionesIibb[c] += impuestoFirmado(mov, mov.percepcionesIibb);
    pnl.memo.otrosTributos[c] += impuestoFirmado(mov, mov.otrosTributos);
  }

  for (const r of input.recibos) {
    const c = col.get(`${r.anio}-${r.mes}`);
    if (c == null || r.costoTotalEmpleador == null) continue;
    const totalRecibo = -Math.round(r.costoTotalEmpleador * 100);
    if (!filtro) {
      pnl.sueldos[c] += totalRecibo;
      continue;
    }
    const parte = parteDelProyecto(totalRecibo, r.lineas, filtro.proyectoId);
    // Recibo sin distribución: entero a la vista "sin proyecto" (sigue siendo
    // claramente sueldos, no hace falta la fila aparte).
    if (parte == null) {
      if (filtro.proyectoId === null) pnl.sueldos[c] += totalRecibo;
    } else {
      pnl.sueldos[c] += parte;
    }
  }

  for (let c = 0; c < N; c++) {
    pnl.subtotalIngresos[c] = [...pnl.ingresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalEgresos[c] = [...pnl.egresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalPersonal[c] = [...pnl.personal.values()].reduce((a, v) => a + v[c], 0) + pnl.sueldos[c];
    pnl.resultado[c] =
      pnl.subtotalIngresos[c] + pnl.subtotalEgresos[c] + pnl.subtotalPersonal[c] + pnl.sinCategoria[c] + pnl.sinDistribucion[c];
    pnl.memo.posicionIva[c] = pnl.memo.ivaDebito[c] + pnl.memo.ivaCredito[c];
  }
  pnl.totalEjercicio.resultado = pnl.resultado.reduce((a, v) => a + v, 0);

  return pnl;
}
