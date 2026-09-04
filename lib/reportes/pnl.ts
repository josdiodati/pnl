import { signoMovimiento } from '@/lib/movimientos/signo';
import { importesPorLinea } from '@/lib/movimientos/distribucion';

// P&L por categoría × mes del ejercicio. SOLO los montos netos computan el
// resultado: base = total − IVA − percepciones − otros tributos (funciona
// igual para comprobantes con desglose y asientos sin él), × TC si la moneda
// es extranjera. Los impuestos indirectos quedan como MEMO bajo el resultado
// (no lo modifican): IVA débito/crédito y posición, percepciones, tributos.
//
// Con `filtro` la misma tabla muestra la porción de una dimensión de las
// líneas de asignación (proyecto, centro de costo o cliente; valor null = las
// líneas sin ese dato), con el reparto al centavo sobre la MISMA base neta: la
// suma de todos los valores + "sin <dimensión>" reproduce el total sin filtro.

export type MesPnl = { anio: number; mes: number };

export type LineaPnl = { centroCostoId: string; clienteId?: string | null; proyectoId?: string | null; porcentaje: number };

export type MovimientoPnl = {
  anio: number;
  mes: number;
  categoriaId: string | null;
  tipoCategoria: 'INGRESO' | 'EGRESO';
  esCostoPersonal: boolean;
  /** Categoría marcada "es impuesto indirecto" (ej. Sircreb): va al memo, no al resultado. */
  esImpuestoIndirecto?: boolean;
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

// Cargo de resumen: línea IGNORADA cuyo motivo afecta el P&L (consumo sin
// comprobante, seguros, comisiones). Monto en pesos FIRMADO tal como vino del
// resumen (débitos negativos). El centro de costo (único, 100%) permite
// atribuirlo en la vista por centro; no tiene proyecto ni cliente.
export type CargoResumenPnl = { anio: number; mes: number; motivo: string; monto: number; centroCostoId?: string | null };

export type CampoPnl = 'proyectoId' | 'centroCostoId' | 'clienteId';
// valor null = líneas sin ese dato (para centroCostoId, siempre presente en la
// línea, junta sólo lo no distribuible).
export type FiltroPnl = { campo: CampoPnl; valor: string | null };

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
  /** Base neta de las categorías "es impuesto indirecto" (ej. Sircreb), por categoría. */
  porCategoria: Map<string, number[]>;
};

export type Pnl = {
  meses: MesPnl[];
  ingresos: Map<string, number[]>; // por categoría INGRESO
  egresos: Map<string, number[]>; // por categoría EGRESO (no personal)
  personal: Map<string, number[]>; // categorías esCostoPersonal (ej. Prepagas)
  sueldos: number[]; // recibos confirmados (costo total empleador), negativo
  sinCategoria: number[]; // asignados sin categoría computable (no debería haber)
  sinDistribucion: number[]; // sólo en la vista "sin <dimensión>": líneas ausentes/inconsistentes (revisar)
  cargos: Map<string, number[]>; // cargos de resúmenes por motivo (sin distribución: enteros a la vista "sin")
  subtotalIngresos: number[];
  subtotalEgresos: number[];
  subtotalPersonal: number[];
  subtotalCargos: number[];
  resultado: number[];
  memo: MemoImpuestos;
  totalEjercicio: { resultado: number };
};

/**
 * Porción de un total firmado que corresponde al valor de la dimensión (o a
 * "sin <dimensión>" con valor null), al centavo. Devuelve null si las líneas
 * faltan o son inconsistentes: quién llama decide qué hacer con eso.
 */
function parteDeLineas(totalCentavos: number, lineas: LineaPnl[] | undefined, filtro: FiltroPnl): number | null {
  if (!lineas?.length) return null;
  try {
    const importes = importesPorLinea(totalCentavos, lineas);
    return lineas.reduce((acc, l, i) => acc + ((l[filtro.campo] ?? null) === filtro.valor ? importes[i] : 0), 0);
  } catch {
    return null;
  }
}

export function armarPnl(input: {
  meses: MesPnl[];
  movimientos: MovimientoPnl[];
  recibos: ReciboPnl[];
  cargos?: CargoResumenPnl[];
  filtro?: FiltroPnl;
}): Pnl {
  const N = input.meses.length;
  const col = new Map(input.meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const ceros = () => Array<number>(N).fill(0);
  const filtro = input.filtro;

  const pnl: Pnl = {
    meses: input.meses,
    ingresos: new Map(),
    egresos: new Map(),
    personal: new Map(),
    sueldos: ceros(),
    sinCategoria: ceros(),
    sinDistribucion: ceros(),
    cargos: new Map(),
    subtotalIngresos: ceros(),
    subtotalEgresos: ceros(),
    subtotalPersonal: ceros(),
    subtotalCargos: ceros(),
    resultado: ceros(),
    memo: {
      ivaDebito: ceros(),
      ivaCredito: ceros(),
      posicionIva: ceros(),
      percepcionesIva: ceros(),
      percepcionesIibb: ceros(),
      otrosTributos: ceros(),
      porCategoria: new Map(),
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

    // Impuesto indirecto por categoría (ej. Sircreb): es un impuesto, no gasto
    // operativo — entero al memo, nunca al resultado. En las vistas filtradas
    // no aplica (el memo se omite ahí).
    if (mov.esImpuestoIndirecto && mov.categoriaId) {
      if (!filtro) sumarEn(pnl.memo.porCategoria, mov.categoriaId, c, base);
      continue;
    }

    let importe = base;
    if (filtro) {
      const parte = parteDeLineas(base, mov.lineas, filtro);
      if (parte == null) {
        // No distribuible: sólo la vista "sin <dimensión>" lo muestra, como
        // fila aparte a revisar — así la suma por valores sigue cerrando.
        if (filtro.valor === null) pnl.sinDistribucion[c] += base;
        continue;
      }
      // Porción exactamente cero: no crear la fila (ruido en la vista filtrada).
      if (parte === 0) continue;
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
    const parte = parteDeLineas(totalRecibo, r.lineas, filtro);
    // Recibo sin distribución: entero a la vista "sin <dimensión>" (sigue
    // siendo claramente sueldos, no hace falta la fila aparte).
    if (parte == null) {
      if (filtro.valor === null) pnl.sueldos[c] += totalRecibo;
    } else {
      pnl.sueldos[c] += parte;
    }
  }

  // Cargos de resúmenes: centro de costo único (100%), sin proyecto/cliente.
  // En la vista por centro se atribuyen a su centro (sin centro → "sin"); en
  // las vistas por proyecto o cliente van enteros a la "sin <dimensión>" (como
  // los recibos sin líneas) — la suma por valores sigue cerrando.
  for (const cargo of input.cargos ?? []) {
    const c = col.get(`${cargo.anio}-${cargo.mes}`);
    if (c == null) continue;
    if (filtro) {
      if (filtro.campo === 'centroCostoId') {
        if ((cargo.centroCostoId ?? null) !== filtro.valor) continue;
      } else if (filtro.valor !== null) {
        continue;
      }
    }
    sumarEn(pnl.cargos, cargo.motivo, c, Math.round(cargo.monto * 100));
  }

  for (let c = 0; c < N; c++) {
    pnl.subtotalIngresos[c] = [...pnl.ingresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalEgresos[c] = [...pnl.egresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalPersonal[c] = [...pnl.personal.values()].reduce((a, v) => a + v[c], 0) + pnl.sueldos[c];
    pnl.subtotalCargos[c] = [...pnl.cargos.values()].reduce((a, v) => a + v[c], 0);
    pnl.resultado[c] =
      pnl.subtotalIngresos[c] + pnl.subtotalEgresos[c] + pnl.subtotalPersonal[c] + pnl.subtotalCargos[c] +
      pnl.sinCategoria[c] + pnl.sinDistribucion[c];
    pnl.memo.posicionIva[c] = pnl.memo.ivaDebito[c] + pnl.memo.ivaCredito[c];
  }
  pnl.totalEjercicio.resultado = pnl.resultado.reduce((a, v) => a + v, 0);

  return pnl;
}
