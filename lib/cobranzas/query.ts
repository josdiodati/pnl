import type { ScopedDb } from '@/lib/empresa/scope';
import { ORIGENES_VENTA } from '@/lib/ventas/query';
import {
  atrasoHistoricoDias,
  estadoCobro,
  saldoVenta,
  type ResultadoEstadoCobro,
  type VentaCobrable,
} from './estado';

// Estado de cobro de TODAS las ventas de la empresa, en una consulta. Se
// deriva a tiempo de query (nada materializado): el histórico de cada cliente
// necesita sus ventas cobradas, así que se cargan todas (volumen chico: decenas
// por mes). Las vistas filtran/ordenan sobre este mapa.

export const INCLUDE_COBRANZA = {
  contraparte: { select: { id: true, razonSocial: true, plazoCobroDias: true } },
  aplicacionesCobro: {
    include: {
      cobro: {
        select: {
          id: true, grupo: true, instrumento: true, estado: true, fecha: true, fechaAcreditacion: true,
          moneda: true, monto: true, numero: true, resumenLineaId: true, origen: true,
        },
      },
    },
  },
} as const;

type FilaVenta = {
  id: string;
  fechaDevengamiento: Date | null;
  total: unknown;
  moneda: string;
  tipoCambio: unknown;
  tipoComprobante: string | null;
  estado: string;
  fechaVencimientoPago: Date | null;
  fechaCobroEstimada: Date | null;
  contraparteId: string | null;
  contraparte: { plazoCobroDias: number | null } | null;
  aplicacionesCobro: { importe: unknown; importeArs: unknown; cobro: { estado: string; fechaAcreditacion: Date } }[];
};

export function aVentaCobrable(m: FilaVenta): VentaCobrable {
  return {
    id: m.id,
    fecha: m.fechaDevengamiento,
    total: m.total == null ? null : Number(m.total),
    moneda: m.moneda,
    tipoCambio: m.tipoCambio == null ? null : Number(m.tipoCambio),
    tipoComprobante: m.tipoComprobante,
    estado: m.estado,
    fechaVencimientoPago: m.fechaVencimientoPago,
    fechaCobroEstimada: m.fechaCobroEstimada,
    plazoCobroDias: m.contraparte?.plazoCobroDias ?? null,
    aplicaciones: m.aplicacionesCobro.map((a) => ({
      importe: Number(a.importe),
      importeArs: Number(a.importeArs),
      estadoCobro: a.cobro.estado,
      fechaAcreditacion: a.cobro.fechaAcreditacion,
    })),
  };
}

export type InfoCobro = ResultadoEstadoCobro & {
  saldo: number; // moneda de la factura
  saldoArs: number | null;
  cobrado: number;
  historicoDias: number | null;
};

/** Hoy (fecha de Buenos Aires) a medianoche UTC: las fechas del libro son fechas puras en UTC. */
export function hoyUtc(ahora = new Date()): Date {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function calcularInfoCobros(filas: FilaVenta[], hoy: Date): Map<string, InfoCobro> {
  const ventas = filas.map((f) => ({ fila: f, venta: aVentaCobrable(f) }));
  const porCliente = new Map<string, VentaCobrable[]>();
  for (const { fila, venta } of ventas) {
    if (!fila.contraparteId) continue;
    const lista = porCliente.get(fila.contraparteId) ?? [];
    lista.push(venta);
    porCliente.set(fila.contraparteId, lista);
  }
  const historico = new Map<string, number | null>();
  for (const [cliente, lista] of porCliente) historico.set(cliente, atrasoHistoricoDias(lista));

  const out = new Map<string, InfoCobro>();
  for (const { fila, venta } of ventas) {
    const historicoDias = fila.contraparteId ? historico.get(fila.contraparteId) ?? null : null;
    const r = estadoCobro(venta, hoy, historicoDias);
    const s = saldoVenta(venta);
    out.set(venta.id, { ...r, saldo: s.saldo, saldoArs: s.saldoArs, cobrado: s.cobrado, historicoDias });
  }
  return out;
}

/** Todas las ventas de la empresa con lo necesario para derivar su cobranza. */
export async function cargarVentasConCobros(db: ScopedDb) {
  return db.movimiento.findMany({
    where: { origen: { in: [...ORIGENES_VENTA] }, estado: { notIn: ['ANULADO', 'DUPLICADO'] } },
    include: INCLUDE_COBRANZA,
    orderBy: [{ fechaDevengamiento: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function mapaCobranza(db: ScopedDb, hoy = hoyUtc()): Promise<Map<string, InfoCobro>> {
  return calcularInfoCobros(await cargarVentasConCobros(db), hoy);
}
