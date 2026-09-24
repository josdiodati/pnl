// Estado de cobro de una venta (Spec F). Todo puro y derivado a tiempo de
// query: saldo = total − lo aplicado por cobros no rechazados; la fecha
// probable sale de la primera fuente disponible (manual > vencimiento impreso
// > plazo del cliente > histórico del cliente > 30 días).

export const PLAZO_DEFECTO_DIAS = 30;
/** Facturas cobradas completas que alimentan el atraso histórico del cliente. */
export const HISTORICO_ULTIMAS = 6;

const DIA_MS = 86_400_000;

export type AplicacionCobrable = {
  importe: number; // moneda de la factura
  importeArs: number;
  estadoCobro: string; // EN_CARTERA | ACREDITADO | RECHAZADO
  fechaAcreditacion: Date;
};

export type VentaCobrable = {
  id: string;
  fecha: Date | null; // fechaDevengamiento (emisión)
  total: number | null;
  moneda: string;
  tipoCambio: number | null;
  tipoComprobante: string | null;
  estado: string;
  fechaVencimientoPago: Date | null;
  fechaCobroEstimada: Date | null;
  plazoCobroDias: number | null; // de la contraparte
  aplicaciones: AplicacionCobrable[];
};

export type FuenteFechaProbable = 'MANUAL' | 'VENCIMIENTO' | 'PLAZO_CLIENTE' | 'HISTORICO' | 'DEFECTO';
export type FechaProbable = { fecha: Date; fuente: FuenteFechaProbable };

export const FUENTE_LABEL: Record<FuenteFechaProbable, string> = {
  MANUAL: 'fijada a mano',
  VENCIMIENTO: 'vencimiento de la factura',
  PLAZO_CLIENTE: 'plazo del cliente',
  HISTORICO: 'histórico del cliente',
  DEFECTO: '30 días',
};

const ESTADOS_NO_COBRABLES = new Set(['ANULADO', 'DUPLICADO', 'ERROR_PROCESAMIENTO', 'PROCESANDO']);

const cent = (n: number) => Math.round(n * 100) / 100;

export function esNotaCredito(tipoComprobante: string | null | undefined): boolean {
  return Boolean(tipoComprobante?.startsWith('NOTA_CREDITO'));
}

/** Una venta es cobrable si está vigente, no es nota de crédito y tiene total. */
export function esCobrable(v: Pick<VentaCobrable, 'estado' | 'tipoComprobante' | 'total'>): boolean {
  return !ESTADOS_NO_COBRABLES.has(v.estado) && !esNotaCredito(v.tipoComprobante) && v.total != null && v.total > 0;
}

/** Pesos por unidad de la moneda de la factura; null si no es computable. */
export function tcFactura(v: Pick<VentaCobrable, 'moneda' | 'tipoCambio'>): number | null {
  if (!v.moneda || v.moneda === 'ARS') return 1;
  return v.tipoCambio && v.tipoCambio > 0 ? v.tipoCambio : null;
}

export function saldoVenta(v: VentaCobrable): { total: number; cobrado: number; saldo: number; saldoArs: number | null } {
  const total = v.total ?? 0;
  const cobrado = cent(v.aplicaciones.filter((a) => a.estadoCobro !== 'RECHAZADO').reduce((s, a) => s + a.importe, 0));
  const saldo = Math.max(0, cent(total - cobrado));
  const tc = tcFactura(v);
  return { total, cobrado, saldo, saldoArs: tc == null ? null : cent(saldo * tc) };
}

const sumarDias = (f: Date, dias: number) => new Date(f.getTime() + dias * DIA_MS);

export function fechaProbableCobro(v: VentaCobrable, historicoDias: number | null): FechaProbable | null {
  if (v.fechaCobroEstimada) return { fecha: v.fechaCobroEstimada, fuente: 'MANUAL' };
  if (v.fechaVencimientoPago) return { fecha: v.fechaVencimientoPago, fuente: 'VENCIMIENTO' };
  if (!v.fecha) return null;
  if (v.plazoCobroDias != null) return { fecha: sumarDias(v.fecha, v.plazoCobroDias), fuente: 'PLAZO_CLIENTE' };
  if (historicoDias != null) return { fecha: sumarDias(v.fecha, historicoDias), fuente: 'HISTORICO' };
  return { fecha: sumarDias(v.fecha, PLAZO_DEFECTO_DIAS), fuente: 'DEFECTO' };
}

export type EstadoCobroVenta = 'COBRADA' | 'PARCIAL' | 'PENDIENTE' | 'NO_APLICA';

export type ResultadoEstadoCobro = {
  estado: EstadoCobroVenta;
  vencida: boolean;
  diasVencida: number;
  fechaProbable: FechaProbable | null;
};

export function estadoCobro(v: VentaCobrable, hoy: Date, historicoDias: number | null = null): ResultadoEstadoCobro {
  if (!esCobrable(v)) return { estado: 'NO_APLICA', vencida: false, diasVencida: 0, fechaProbable: null };
  const { cobrado, saldo } = saldoVenta(v);
  const fechaProbable = fechaProbableCobro(v, historicoDias);
  if (saldo <= 0.01) return { estado: 'COBRADA', vencida: false, diasVencida: 0, fechaProbable };
  const estado: EstadoCobroVenta = cobrado > 0 ? 'PARCIAL' : 'PENDIENTE';
  const diasVencida = fechaProbable ? Math.floor((hoy.getTime() - fechaProbable.fecha.getTime()) / DIA_MS) : 0;
  return { estado, vencida: diasVencida > 0, diasVencida: Math.max(0, diasVencida), fechaProbable };
}

/**
 * Días promedio entre la emisión y la última acreditación de las últimas
 * HISTORICO_ULTIMAS facturas cobradas completas de un cliente. null si no hay.
 */
export function atrasoHistoricoDias(ventasCliente: VentaCobrable[]): number | null {
  const cobradas = ventasCliente
    .filter((v) => v.fecha && esCobrable(v) && v.aplicaciones.some((a) => a.estadoCobro !== 'RECHAZADO') && saldoVenta(v).saldo <= 0.01)
    .sort((a, b) => b.fecha!.getTime() - a.fecha!.getTime())
    .slice(0, HISTORICO_ULTIMAS);
  if (cobradas.length === 0) return null;
  const dias = cobradas.map((v) => {
    const ultima = Math.max(...v.aplicaciones.filter((a) => a.estadoCobro !== 'RECHAZADO').map((a) => a.fechaAcreditacion.getTime()));
    return Math.max(0, (ultima - v.fecha!.getTime()) / DIA_MS);
  });
  return Math.round(dias.reduce((s, x) => s + x, 0) / dias.length);
}
