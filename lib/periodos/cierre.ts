import { prisma } from '@/lib/db';
import type { ScopedDb } from '@/lib/empresa/scope';
import { ESTADOS_BLOQUEAN_CIERRE } from '@/lib/movimientos/estados';
import { correspondeAlMes } from '@/lib/empleados/mes';
import { PROBLEMAS } from '@/lib/comprobantes/query';

// Estado de cierre de un mes: qué falta resolver en comprobantes, resúmenes,
// ARCA y sueldos. Lo usan la lista de Períodos (resumen por mes) y el detalle
// del mes (con links a cada sección). SÓLO los comprobantes bloquean el cierre
// (misma regla que cerrarPeriodo); el resto es informativo.

export type Mes = { anio: number; mes: number };

export type ResumenDelMes = {
  id: string;
  emisor: string;
  tipo: string;
  estado: string;
  lineas: number;
  sinConciliar: number; // líneas PENDIENTE + SUGERIDA
};

export type EstadoCierreMes = {
  comprobantes: {
    porValidar: number; // PENDIENTE_VALIDACION
    observados: number;
    porAsignar: number; // VALIDADO
    retenidos: number;
    conError: number; // ERROR_PROCESAMIENTO (informativo)
  };
  resumenes: ResumenDelMes[];
  arca: { conectado: boolean; faltantes: number; noFiguranEnArca: number };
  sueldos: { hayEmpleados: boolean; pendientes: number; sinRecibo: number };
  /** Comprobantes que impiden cerrar (regla de cerrarPeriodo). */
  bloqueantes: number;
  /** Temas informativos (resúmenes, ARCA, sueldos, errores de procesamiento). */
  advertencias: number;
};

export const claveMes = (anio: number, mes: number) => `${anio}-${mes}`;

export function rangoMes({ anio, mes }: Mes) {
  return { desde: new Date(Date.UTC(anio, mes - 1, 1)), hasta: new Date(Date.UTC(anio, mes, 1)) };
}

const claveFecha = (d: Date) => claveMes(d.getUTCFullYear(), d.getUTCMonth() + 1);

/** Estado de cierre de cada mes pedido (pocas consultas para todo el rango). */
export async function estadoCierre(db: ScopedDb, empresaId: string, meses: Mes[]): Promise<Map<string, EstadoCierreMes>> {
  const out = new Map<string, EstadoCierreMes>();
  if (!meses.length) return out;
  const orden = [...meses].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
  const desde = rangoMes(orden[0]).desde;
  const hasta = rangoMes(orden[orden.length - 1]).hasta;
  const enRango = { gte: desde, lt: hasta };
  const claves = new Set(meses.map((m) => claveMes(m.anio, m.mes)));

  const [movs, periodos, credencial, noFiguran, arcaFaltantes, empleados] = await Promise.all([
    db.movimiento.findMany({
      where: { fechaDevengamiento: enRango, estado: { in: [...ESTADOS_BLOQUEAN_CIERRE, 'ERROR_PROCESAMIENTO'] } },
      select: { estado: true, fechaDevengamiento: true },
    }),
    db.periodo.findMany({
      where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
      select: { id: true, anio: true, mes: true },
    }),
    prisma.credencialArca.findUnique({ where: { empresaId }, select: { id: true } }),
    db.movimiento.findMany({
      where: {
        fechaDevengamiento: enRango,
        // Mismo criterio que el filtro "Sin validar en ARCA" de Comprobantes
        // (al que linkea el detalle), sin anulados ni duplicados.
        ...PROBLEMAS.arca.where,
        estado: { notIn: ['ANULADO', 'DUPLICADO', 'INGRESADO', 'PROCESANDO', 'ERROR_PROCESAMIENTO', 'NO_COMPROBANTE'] },
      },
      select: { fechaDevengamiento: true },
    }),
    db.comprobanteArca.findMany({
      where: { fechaEmision: enRango, movimientoId: null, ignoradoAt: null },
      select: { fechaEmision: true },
    }),
    db.empleado.findMany({ where: { activo: true }, select: { id: true, fechaEgreso: true } }),
  ]);

  const periodoPorId = new Map(periodos.map((p) => [p.id, claveMes(p.anio, p.mes)]));
  const periodoIds = periodos.map((p) => p.id);
  const [resumenes, recibos] = await Promise.all([
    periodoIds.length
      ? db.resumen.findMany({
          where: { periodoId: { in: periodoIds } },
          select: { id: true, emisor: true, tipo: true, estado: true, periodoId: true },
          orderBy: { emisor: 'asc' },
        })
      : Promise.resolve([]),
    periodoIds.length
      ? db.reciboSueldo.findMany({
          where: { periodoId: { in: periodoIds }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
          select: { periodoId: true, empleadoId: true, estado: true },
        })
      : Promise.resolve([]),
  ]);
  const lineas = resumenes.length
    ? await prisma.resumenLinea.groupBy({
        by: ['resumenId', 'estado'],
        where: { resumenId: { in: resumenes.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];

  for (const k of claves) {
    out.set(k, {
      comprobantes: { porValidar: 0, observados: 0, porAsignar: 0, retenidos: 0, conError: 0 },
      resumenes: [],
      arca: { conectado: credencial != null, faltantes: 0, noFiguranEnArca: 0 },
      sueldos: { hayEmpleados: empleados.length > 0, pendientes: 0, sinRecibo: 0 },
      bloqueantes: 0,
      advertencias: 0,
    });
  }

  for (const m of movs) {
    const e = m.fechaDevengamiento && out.get(claveFecha(m.fechaDevengamiento));
    if (!e) continue;
    if (m.estado === 'PENDIENTE_VALIDACION') e.comprobantes.porValidar++;
    else if (m.estado === 'OBSERVADO') e.comprobantes.observados++;
    else if (m.estado === 'VALIDADO') e.comprobantes.porAsignar++;
    else if (m.estado === 'RETENIDO') e.comprobantes.retenidos++;
    else if (m.estado === 'ERROR_PROCESAMIENTO') e.comprobantes.conError++;
  }

  for (const r of resumenes) {
    const e = out.get(periodoPorId.get(r.periodoId) ?? '');
    if (!e) continue;
    const deEste = lineas.filter((l) => l.resumenId === r.id);
    e.resumenes.push({
      id: r.id,
      emisor: r.emisor,
      tipo: r.tipo,
      estado: r.estado,
      lineas: deEste.reduce((a, l) => a + l._count._all, 0),
      sinConciliar: deEste.filter((l) => l.estado === 'PENDIENTE' || l.estado === 'SUGERIDA').reduce((a, l) => a + l._count._all, 0),
    });
  }

  if (credencial) {
    for (const a of arcaFaltantes) {
      const e = out.get(claveFecha(a.fechaEmision));
      if (e) e.arca.faltantes++;
    }
    for (const m of noFiguran) {
      const e = m.fechaDevengamiento && out.get(claveFecha(m.fechaDevengamiento));
      if (e) e.arca.noFiguranEnArca++;
    }
  }

  // Sueldos: pendientes de revisión y empleados que corresponden al mes sin
  // recibo — sólo en meses con algún recibo cargado (si no hay ninguno, el mes
  // todavía no se liquidó y "sin recibo" no dice nada).
  const conRecibo = new Map<string, Set<string>>();
  for (const r of recibos) {
    const k = periodoPorId.get(r.periodoId);
    const e = k ? out.get(k) : undefined;
    if (!k || !e) continue;
    if (r.estado === 'PENDIENTE_REVISION') e.sueldos.pendientes++;
    conRecibo.set(k, (conRecibo.get(k) ?? new Set()).add(r.empleadoId));
  }
  for (const m of meses) {
    const k = claveMes(m.anio, m.mes);
    const ids = conRecibo.get(k);
    const e = out.get(k)!;
    if (ids) e.sueldos.sinRecibo = empleados.filter((emp) => correspondeAlMes(emp, m.anio, m.mes) && !ids.has(emp.id)).length;
  }

  for (const e of out.values()) {
    e.bloqueantes = e.comprobantes.porValidar + e.comprobantes.observados + e.comprobantes.porAsignar + e.comprobantes.retenidos;
    e.advertencias =
      e.comprobantes.conError +
      e.resumenes.reduce((a, r) => a + r.sinConciliar + (r.estado === 'ERROR_PROCESAMIENTO' ? 1 : 0), 0) +
      e.arca.faltantes +
      e.arca.noFiguranEnArca +
      e.sueldos.pendientes +
      e.sueldos.sinRecibo;
  }
  return out;
}
