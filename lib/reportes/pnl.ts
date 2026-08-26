import { signoMovimiento } from '@/lib/movimientos/signo';

// P&L por categoría × mes del ejercicio. SOLO los montos netos computan el
// resultado: base = total − IVA − percepciones − otros tributos (funciona
// igual para comprobantes con desglose y asientos sin él), × TC si la moneda
// es extranjera. Los impuestos indirectos quedan como MEMO bajo el resultado
// (no lo modifican): IVA débito/crédito y posición, percepciones, tributos.

export type MesPnl = { anio: number; mes: number };

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
};

export type ReciboPnl = { anio: number; mes: number; costoTotalEmpleador: number | null };

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
  subtotalIngresos: number[];
  subtotalEgresos: number[];
  subtotalPersonal: number[];
  resultado: number[];
  memo: MemoImpuestos;
  totalEjercicio: { resultado: number };
};

export function armarPnl(input: { meses: MesPnl[]; movimientos: MovimientoPnl[]; recibos: ReciboPnl[] }): Pnl {
  const N = input.meses.length;
  const col = new Map(input.meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const ceros = () => Array<number>(N).fill(0);

  const pnl: Pnl = {
    meses: input.meses,
    ingresos: new Map(),
    egresos: new Map(),
    personal: new Map(),
    sueldos: ceros(),
    sinCategoria: ceros(),
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

    if (!mov.categoriaId) {
      pnl.sinCategoria[c] += base;
    } else if (mov.esCostoPersonal) {
      sumarEn(pnl.personal, mov.categoriaId, c, base);
    } else if (mov.tipoCategoria === 'INGRESO') {
      sumarEn(pnl.ingresos, mov.categoriaId, c, base);
    } else {
      sumarEn(pnl.egresos, mov.categoriaId, c, base);
    }

    // Memo de impuestos indirectos (bajo el resultado, no lo modifican).
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
    pnl.sueldos[c] -= Math.round(r.costoTotalEmpleador * 100);
  }

  for (let c = 0; c < N; c++) {
    pnl.subtotalIngresos[c] = [...pnl.ingresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalEgresos[c] = [...pnl.egresos.values()].reduce((a, v) => a + v[c], 0);
    pnl.subtotalPersonal[c] = [...pnl.personal.values()].reduce((a, v) => a + v[c], 0) + pnl.sueldos[c];
    pnl.resultado[c] = pnl.subtotalIngresos[c] + pnl.subtotalEgresos[c] + pnl.subtotalPersonal[c] + pnl.sinCategoria[c];
    pnl.memo.posicionIva[c] = pnl.memo.ivaDebito[c] + pnl.memo.ivaCredito[c];
  }
  pnl.totalEjercicio.resultado = pnl.resultado.reduce((a, v) => a + v, 0);

  return pnl;
}
