import type { ScopedDb } from '@/lib/empresa/scope';
import { netoComputable } from './prepaga';

// Costo de personal de UN mes por empleado (recibos + vinculados + prepaga),
// compartido por la pestaña Empleados y el Detalle mensual. Con centro
// filtrado, cada columna es LA PORCIÓN de ese centro (cuadra con la matriz).

export type CostoEmpleadoMes = {
  recibos: number;
  vinculado: number;
  prepaga: number;
  pendiente: boolean; // recibo pendiente, o confirmado sin distribución
  tieneRecibo: boolean;
  centros: Set<string>;
};

export async function costosDelMes(
  db: ScopedDb,
  anio: number,
  mes: number,
  centroFiltro: string | null = null,
): Promise<Map<string, CostoEmpleadoMes>> {
  const [recibos, vinculos, prepagas] = await Promise.all([
    db.reciboSueldo.findMany({
      where: { periodo: { anio, mes }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
      include: { lineas: true },
    }),
    db.movimientoEmpleado.findMany({
      where: { movimiento: { estado: 'ASIGNADO', periodo: { anio, mes } } },
      include: { empleado: { include: { distribucion: true } } },
    }),
    db.prepagaEmpleado.findMany({
      where: { periodo: { anio, mes } },
      include: { empleado: { include: { distribucion: true } } },
    }),
  ]);

  // Porcentaje de unas líneas que cae en el centro filtrado (1 si no hay filtro).
  const pctEnCentro = (lineas: { centroCostoId: string; porcentaje: unknown }[]) => {
    if (!centroFiltro || centroFiltro === 'SIN_ASIGNAR') return 1;
    return lineas.filter((l) => l.centroCostoId === centroFiltro).reduce((a, l) => a + Number(l.porcentaje), 0) / 100;
  };

  const out = new Map<string, CostoEmpleadoMes>();
  const de = (id: string) => {
    let c = out.get(id);
    if (!c) {
      c = { recibos: 0, vinculado: 0, prepaga: 0, pendiente: false, tieneRecibo: false, centros: new Set() };
      out.set(id, c);
    }
    return c;
  };

  for (const r of recibos) {
    const c = de(r.empleadoId);
    c.tieneRecibo = true;
    if (r.estado === 'CONFIRMADO') {
      c.recibos += Number(r.costoTotalEmpleador ?? 0) * pctEnCentro(r.lineas);
      for (const l of r.lineas) c.centros.add(l.centroCostoId);
      if (r.lineas.length === 0) c.pendiente = true; // confirmado sin líneas: cuenta como sin asignar
    } else c.pendiente = true;
  }
  for (const v of vinculos) de(v.empleadoId).vinculado += Number(v.monto) * pctEnCentro(v.empleado.distribucion);
  // Prepagas ASIGNADAS (gestión): la porción del centro sale de la ficha.
  for (const p of prepagas) {
    const neto =
      netoComputable({
        costoPlan: Number(p.costoPlan),
        aportes: Number(p.aportes),
        contribuciones: Number(p.contribuciones),
        fsrPct: Number(p.fsrPct),
      }) / 100;
    const porcion = neto * pctEnCentro(p.empleado.distribucion);
    if (porcion > 0) de(p.empleadoId).prepaga += porcion;
  }
  return out;
}

export const totalEmpleadoMes = (c: CostoEmpleadoMes | undefined) => (c ? c.recibos + c.vinculado + c.prepaga : 0);

/** Último período (año/mes) con algún recibo confirmado o pendiente. */
export async function ultimoPeriodoConRecibos(db: ScopedDb): Promise<{ anio: number; mes: number } | null> {
  const r = await db.reciboSueldo.findFirst({
    where: { estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
    include: { periodo: true },
    orderBy: [{ periodo: { anio: 'desc' } }, { periodo: { mes: 'desc' } }],
  });
  return r ? { anio: r.periodo.anio, mes: r.periodo.mes } : null;
}

/** Un empleado corresponde a un mes si no egresó o si egresó ese mes o
 *  después: su último recibo es el del mes de egreso, así que en los meses
 *  siguientes no se lo muestra como "sin recibo". */
export function correspondeAlMes(e: { fechaEgreso: Date | null }, anio: number, mes: number): boolean {
  if (!e.fechaEgreso) return true;
  const egreso = e.fechaEgreso.getUTCFullYear() * 12 + e.fechaEgreso.getUTCMonth();
  return egreso >= anio * 12 + (mes - 1);
}
