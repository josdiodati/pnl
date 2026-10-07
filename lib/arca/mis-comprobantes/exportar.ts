// Filtros de la pantalla ARCA · Mis Comprobantes y su exportación a XLSX: una
// fila por comprobante de ARCA con, al lado, los datos del comprobante de PNL
// con el que cruzó (o el motivo por el que se ignoró). Los filtros son los
// mismos que los de la pantalla, así el archivo trae exactamente lo que se ve.

import type { CeldaXlsx } from '@/lib/movimientos/xlsx';
import { nombreTipoArca, numeroComprobanteArca } from './tipos-arca';

export type EstadoFiltroArca = 'todos' | 'faltantes' | 'cruzados' | 'ignorados';
// `ejercicio` acota "todos" a un ejercicio contable (año de inicio + mes de inicio de la empresa).
export type FiltrosArca = { mes: string; origen?: 'EMITIDO' | 'RECIBIDO'; estado: EstadoFiltroArca; ejercicio?: { anio: number; inicio: number } };

export const SIN_RESOLVER = { movimientoId: null, ignoradoAt: null };
export const IGNORADOS = { movimientoId: null, ignoradoAt: { not: null } };

/**
 * Mes "YYYY-MM" o "todos"; si no viene (o no es válido), el de `mesPorDefecto`.
 * Con "todos", `ejercicio` (año de inicio) lo acota a ese ejercicio contable
 * cuando se conoce el mes de inicio de la empresa.
 */
export function parsearFiltrosArca(
  sp: { mes?: string | null; origen?: string | null; estado?: string | null; ejercicio?: string | null },
  mesPorDefecto: string,
  inicioEjercicio?: number,
): FiltrosArca {
  const origen = sp.origen === 'EMITIDO' || sp.origen === 'RECIBIDO' ? sp.origen : undefined;
  const estado = sp.estado === 'faltantes' || sp.estado === 'cruzados' || sp.estado === 'ignorados' ? sp.estado : 'todos';
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes! : sp.mes === 'todos' ? 'todos' : mesPorDefecto;
  const ejercicio = mes === 'todos' && inicioEjercicio && /^\d{4}$/.test(sp.ejercicio ?? '') ? { anio: Number(sp.ejercicio), inicio: inicioEjercicio } : undefined;
  return { mes, origen, estado, ...(ejercicio ? { ejercicio } : {}) };
}

export function rangoDeMes(mes: string): { gte: Date; lt: Date } | undefined {
  if (mes === 'todos') return undefined;
  const [anio, m] = mes.split('-').map(Number);
  return { gte: new Date(Date.UTC(anio, m - 1, 1)), lt: new Date(Date.UTC(anio, m, 1)) };
}

/** Los 12 meses del ejercicio que empieza en {anio, inicio}. */
export function rangoDeEjercicio(anio: number, inicio: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(anio, inicio - 1, 1)), lt: new Date(Date.UTC(anio + 1, inicio - 1, 1)) };
}

export function rangoDeFiltros(f: FiltrosArca): { gte: Date; lt: Date } | undefined {
  return f.ejercicio ? rangoDeEjercicio(f.ejercicio.anio, f.ejercicio.inicio) : rangoDeMes(f.mes);
}

export function whereArca(f: FiltrosArca) {
  const rango = rangoDeFiltros(f);
  return {
    ...(f.origen ? { origen: f.origen } : {}),
    ...(f.estado === 'faltantes' ? SIN_RESOLVER : f.estado === 'cruzados' ? { movimientoId: { not: null } } : f.estado === 'ignorados' ? IGNORADOS : {}),
    ...(rango ? { fechaEmision: rango } : {}),
  };
}

type Dec = { toString(): string } | number | null;

export type ComprobanteArcaExport = {
  origen: 'EMITIDO' | 'RECIBIDO';
  fechaEmision: Date;
  tipoComprobante: number;
  puntoVenta: number;
  numeroDesde: number;
  nroDocContraparte: string;
  denominacionContraparte: string | null;
  moneda: string | null;
  tipoCambio: Dec;
  netoGravadoTotal: Dec;
  netoNoGravado: Dec;
  exentas: Dec;
  otrosTributos: Dec;
  totalIva: Dec;
  importeTotal: Dec;
  codigoAutorizacion: string | null;
  movimientoId: string | null;
  ignoradoAt: Date | null;
  motivoIgnorado: string | null;
  ignoradoPor: { nombre: string } | null;
  movimiento: {
    id: string;
    estado: string;
    fechaDevengamiento: Date | null;
    tipoComprobante: string | null;
    puntoVenta: string | null;
    numero: string | null;
    cuitEmisor: string | null;
    descripcion: string | null;
    moneda: string;
    tipoCambio: Dec;
    netoGravado: Dec;
    iva105: Dec;
    iva21: Dec;
    iva27: Dec;
    total: Dec;
    cae: string | null;
    contraparte: { cuit: string | null; razonSocial: string } | null;
    categoria: { nombre: string } | null;
  } | null;
};

export const ENCABEZADOS_EXPORT_ARCA = [
  'fecha_emision', 'origen', 'tipo', 'numero', 'cuit_contraparte', 'contraparte', 'moneda', 'tipo_cambio',
  'neto_gravado', 'no_gravado', 'exento', 'otros_tributos', 'iva', 'total', 'cae',
  'estado_en_pnl', 'motivo_ignorado', 'ignorado_por', 'ignorado_el',
  'pnl_fecha', 'pnl_tipo', 'pnl_numero', 'pnl_cuit_contraparte', 'pnl_contraparte', 'pnl_categoria', 'pnl_descripcion', 'pnl_estado',
  'pnl_moneda', 'pnl_tipo_cambio', 'pnl_neto_gravado', 'pnl_iva', 'pnl_total', 'diferencia_total', 'pnl_cae', 'pnl_link',
];

const num = (v: Dec): number | null => (v == null ? null : Number(v));
const fecha = (d: Date | null): string | null => d?.toISOString().slice(0, 10) ?? null;
/** ARCA informa la moneda con su código ('$' o 'PES' son pesos). */
const esPesosArca = (m: string | null) => m == null || m === '$' || m === 'PES';

export function filasExportArca(comprobantes: ComprobanteArcaExport[], urlApp: string, slug: string): CeldaXlsx[][] {
  return comprobantes.map((c) => {
    const m = c.movimiento;
    const estadoPnl = c.movimientoId ? 'Cruzado' : c.ignoradoAt ? 'Ignorado' : 'Falta en PNL';
    const ivaPnl = m ? [m.iva105, m.iva21, m.iva27].reduce<number | null>((s, v) => (v == null ? s : (s ?? 0) + Number(v)), null) : null;
    // Diferencia sólo si las dos puntas están en la misma moneda.
    const mismaMoneda = m && (esPesosArca(c.moneda) ? m.moneda === 'ARS' : m.moneda !== 'ARS');
    const diferencia = m && mismaMoneda && c.importeTotal != null && m.total != null ? Math.round((Number(c.importeTotal) - Number(m.total)) * 100) / 100 : null;
    return [
      fecha(c.fechaEmision), c.origen === 'EMITIDO' ? 'Emitido' : 'Recibido', nombreTipoArca(c.tipoComprobante),
      numeroComprobanteArca(c.puntoVenta, c.numeroDesde), c.nroDocContraparte || null, c.denominacionContraparte,
      c.moneda, num(c.tipoCambio), num(c.netoGravadoTotal), num(c.netoNoGravado), num(c.exentas), num(c.otrosTributos),
      num(c.totalIva), num(c.importeTotal), c.codigoAutorizacion,
      estadoPnl, c.ignoradoAt ? c.motivoIgnorado : null, c.ignoradoAt ? (c.ignoradoPor?.nombre ?? null) : null, fecha(c.ignoradoAt),
      fecha(m?.fechaDevengamiento ?? null), m?.tipoComprobante ?? null,
      m ? [m.puntoVenta, m.numero].filter(Boolean).join('-') || null : null,
      m?.contraparte?.cuit ?? m?.cuitEmisor ?? null, m?.contraparte?.razonSocial ?? null, m?.categoria?.nombre ?? null,
      m?.descripcion ?? null, m?.estado ?? null, m?.moneda ?? null, num(m?.tipoCambio ?? null), num(m?.netoGravado ?? null),
      ivaPnl, num(m?.total ?? null), diferencia, m?.cae ?? null,
      m ? `${urlApp}/${slug}/validacion/${m.id}` : null,
    ];
  });
}
