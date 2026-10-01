import type { ScopedDb } from '@/lib/empresa/scope';
import { armarPnl, type MesPnl, type MovimientoPnl, type ReciboPnl } from './pnl';
import { calcularProrrateos, facturacionPorCentro, headcountPorCentro, type CriterioProrrateo } from './prorrateo';

// Lectura de la base para el Reporte P&L y lo que lo explica (Desglose de un
// centro de costo): un solo lugar, así ambos ven exactamente los mismos datos.
// Sólo movimientos ASIGNADOS y recibos CONFIRMADOS de los meses pedidos.

const num = (v: { toString(): string } | null) => (v != null ? Number(v) : null);

export async function cargarDatosPnl(db: ScopedDb, meses: MesPnl[]) {
  const periodos = await db.periodo.findMany({ where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) } });
  const periodoIds = periodos.map((p) => p.id);
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const [movimientos, recibos] = await Promise.all([
    db.movimiento.findMany({
      where: { estado: 'ASIGNADO', periodoId: { in: periodoIds } },
      include: { categoria: true, lineas: true, contraparte: { select: { razonSocial: true } } },
    }),
    db.reciboSueldo.findMany({
      where: { estado: 'CONFIRMADO', periodoId: { in: periodoIds } },
      include: { periodo: true, lineas: true, empleado: { select: { nombre: true } } },
    }),
  ]);

  const movimientosPnl = movimientos.map((m): MovimientoPnl & { id: string } => {
    const p = periodoPorId.get(m.periodoId!)!;
    return {
      id: m.id,
      anio: p.anio,
      mes: p.mes,
      categoriaId: m.categoriaId,
      tipoCategoria: (m.categoria?.tipo ?? 'EGRESO') as 'INGRESO' | 'EGRESO',
      esCostoPersonal: m.categoria?.esCostoPersonal ?? false,
      esImpuestoIndirecto: m.categoria?.esImpuestoIndirecto ?? false,
      tipoComprobante: m.tipoComprobante,
      moneda: m.moneda,
      tipoCambio: num(m.tipoCambio),
      total: num(m.total),
      iva21: num(m.iva21),
      iva105: num(m.iva105),
      iva27: num(m.iva27),
      percepcionesIva: num(m.percepcionesIva),
      percepcionesIibb: num(m.percepcionesIibb),
      otrosTributos: num(m.otrosTributos),
      lineas: m.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      })),
    };
  });
  const recibosPnl = recibos.map((r): ReciboPnl & { id: string } => ({
    id: r.id,
    anio: r.periodo.anio,
    mes: r.periodo.mes,
    costoTotalEmpleador: num(r.costoTotalEmpleador),
    lineas: r.lineas.map((l) => ({
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: Number(l.porcentaje),
    })),
  }));

  return { movimientos, recibos, movimientosPnl, recibosPnl };
}

export type DatosPnl = Awaited<ReturnType<typeof cargarDatosPnl>>;

/**
 * Prorrateos de los centros prorrateables (método directo, ver
 * lib/reportes/prorrateo.ts) y el resultado de cada emisor antes de repartir.
 * null si la empresa no tiene centros prorrateables.
 */
export async function prorrateosDelPnl(
  db: ScopedDb,
  meses: MesPnl[],
  centros: { id: string; prorrateo: CriterioProrrateo | null }[],
  datos: DatosPnl,
) {
  const prorrateables = centros.filter((c) => c.prorrateo);
  if (!prorrateables.length) return null;
  const usa = (k: CriterioProrrateo) => prorrateables.some((c) => c.prorrateo === k);
  const empleados = usa('HEADCOUNT') ? await db.empleado.findMany({ include: { distribucion: true } }) : [];
  const resultadoEmisor = new Map(
    prorrateables.map((c) => [
      c.id,
      armarPnl({ meses, movimientos: datos.movimientosPnl, recibos: datos.recibosPnl, filtro: { campo: 'centroCostoId', valor: c.id } }).resultado,
    ]),
  );
  const prorrateos = calcularProrrateos({
    meses,
    centros: centros.map((c) => ({ id: c.id, prorrateo: c.prorrateo })),
    resultadoEmisor,
    drivers: {
      HEADCOUNT: usa('HEADCOUNT')
        ? headcountPorCentro({
            meses,
            recibos: datos.recibos
              .filter((r) => r.tipo === 'MENSUAL')
              .map((r) => ({
                empleadoId: r.empleadoId,
                anio: r.periodo.anio,
                mes: r.periodo.mes,
                lineas: r.lineas.map((l) => ({ centroCostoId: l.centroCostoId, porcentaje: Number(l.porcentaje) })),
              })),
            empleados: empleados.map((e) => ({
              id: e.id,
              activo: e.activo,
              fechaIngreso: e.fechaIngreso,
              fechaEgreso: e.fechaEgreso,
              ficha: e.distribucion.map((l) => ({ centroCostoId: l.centroCostoId, porcentaje: Number(l.porcentaje) })),
            })),
          })
        : new Map(),
      FACTURACION: usa('FACTURACION') ? facturacionPorCentro({ meses, movimientos: datos.movimientosPnl }) : new Map(),
    },
  });
  return { prorrateos, resultadoEmisor };
}
