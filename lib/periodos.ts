import type { Periodo } from '@prisma/client';
import type { ScopedDb } from '@/lib/empresa/scope';

// Periods are calendar months per company, grouped into a fiscal year that
// starts at Empresa.inicioEjercicioFiscal (default July).

export function periodoDeFecha(fecha: Date): { anio: number; mes: number } {
  return { anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1 };
}

/** Fiscal year (identified by its starting calendar year) containing a month. */
export function ejercicioDeMes(anio: number, mes: number, inicioEjercicio: number): number {
  return mes >= inicioEjercicio ? anio : anio - 1;
}

/** The 12 {anio, mes} of a fiscal year starting at `inicioEjercicio`. */
export function mesesDeEjercicio(anioEjercicio: number, inicioEjercicio: number): { anio: number; mes: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = inicioEjercicio + i;
    return m <= 12 ? { anio: anioEjercicio, mes: m } : { anio: anioEjercicio + 1, mes: m - 12 };
  });
}

export const MES_LABEL = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function nombrePeriodo(anio: number, mes: number): string {
  return `${MES_LABEL[mes]} ${anio}`;
}

/** Gets (or lazily creates, OPEN) the period of a date. db is empresa-scoped. */
export async function getOrCreatePeriodo(db: ScopedDb, fecha: Date): Promise<Periodo> {
  const { anio, mes } = periodoDeFecha(fecha);
  const existente = await db.periodo.findFirst({ where: { anio, mes } });
  if (existente) return existente;
  try {
    return await db.periodo.create({ data: { anio, mes } as never });
  } catch {
    // unique race: another request created it in between
    const otraVez = await db.periodo.findFirst({ where: { anio, mes } });
    if (!otraVez) throw new Error(`No se pudo crear el período ${anio}-${mes}`);
    return otraVez;
  }
}

/** True if the period containing `fecha` exists and is CLOSED. */
export async function periodoEstaCerrado(db: ScopedDb, fecha: Date): Promise<boolean> {
  const { anio, mes } = periodoDeFecha(fecha);
  const periodo = await db.periodo.findFirst({ where: { anio, mes } });
  return periodo?.estado === 'CERRADO';
}
