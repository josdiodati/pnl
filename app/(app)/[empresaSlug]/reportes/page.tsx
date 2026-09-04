import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { armarPnl, type MovimientoPnl, type FiltroPnl } from '@/lib/reportes/pnl';
import { MOTIVOS_IGNORO_PNL } from '@/lib/resumenes/motivos';
import { PageHeader } from '@/components/page-header';

// Reporte P&L: categorías (eje Y) × meses del ejercicio (eje X), en pesos.
// SOLO montos netos computan el resultado; los impuestos indirectos (IVA,
// percepciones, tributos) van como memo debajo — no modifican el resultado.

const fmt = (centavos: number) =>
  centavos === 0 ? '—' : (centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 });

export default async function ReportesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ejercicio?: string; vista?: string; proyecto?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const base = `/${params.empresaSlug}`;
  const hoy = periodoDeFecha(new Date());
  const inicio = ctx.empresa.inicioEjercicioFiscal;
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioDeMes(hoy.anio, hoy.mes, inicio));
  const meses = mesesDeEjercicio(ejercicio, inicio);
  // Vista por dimensión de línea: 'p:<id>' proyecto, 'cc:<id>' centro de
  // costo, 'cl:<id>' cliente; '<pref>:sin' = líneas sin ese dato; ausente =
  // P&L completo. `proyecto` queda como alias legacy de 'p:'.
  const vistaParam = searchParams.vista || (searchParams.proyecto ? `p:${searchParams.proyecto}` : undefined) || undefined;
  const CAMPO_VISTA = { p: 'proyectoId', cc: 'centroCostoId', cl: 'clienteId' } as const;
  let filtro: FiltroPnl | undefined;
  if (vistaParam) {
    const [pref, ...resto] = vistaParam.split(':');
    const valor = resto.join(':');
    const campo = CAMPO_VISTA[pref as keyof typeof CAMPO_VISTA];
    if (campo && valor) filtro = { campo, valor: valor === 'sin' ? null : valor };
  }

  const periodos = await ctx.db.periodo.findMany({
    where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
  });
  const periodoIds = periodos.map((p) => p.id);
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const [movimientos, recibos, categorias, proyectos, centros, clientes] = await Promise.all([
    ctx.db.movimiento.findMany({
      where: { estado: 'ASIGNADO', periodoId: { in: periodoIds } },
      include: { categoria: true, lineas: true },
    }),
    ctx.db.reciboSueldo.findMany({
      where: { estado: 'CONFIRMADO', periodoId: { in: periodoIds } },
      include: { periodo: true, lineas: true },
    }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ orderBy: { nombre: 'asc' } }),
  ]);

  // Cargos de resúmenes: líneas IGNORADAS con motivo que afecta el P&L
  // (consumo sin comprobante, seguros, comisiones). El mes sale de la fecha de
  // la línea (fallback: período del resumen), igual que la imputación;
  // armarPnl descarta lo que caiga fuera del ejercicio.
  const lineasCargo = await ctx.db.resumenLinea.findMany({
    where: { estado: 'IGNORADA', motivoIgnorada: { in: [...MOTIVOS_IGNORO_PNL] }, monto: { not: null } },
    include: { resumen: { include: { periodo: true } } },
  });

  const pnl = armarPnl({
    meses,
    movimientos: movimientos.map((m): MovimientoPnl => {
      const p = periodoPorId.get(m.periodoId!)!;
      return {
        anio: p.anio,
        mes: p.mes,
        categoriaId: m.categoriaId,
        tipoCategoria: (m.categoria?.tipo ?? 'EGRESO') as 'INGRESO' | 'EGRESO',
        esCostoPersonal: m.categoria?.esCostoPersonal ?? false,
        esImpuestoIndirecto: m.categoria?.esImpuestoIndirecto ?? false,
        tipoComprobante: m.tipoComprobante,
        moneda: m.moneda,
        tipoCambio: m.tipoCambio != null ? Number(m.tipoCambio) : null,
        total: m.total != null ? Number(m.total) : null,
        iva21: m.iva21 != null ? Number(m.iva21) : null,
        iva105: m.iva105 != null ? Number(m.iva105) : null,
        iva27: m.iva27 != null ? Number(m.iva27) : null,
        percepcionesIva: m.percepcionesIva != null ? Number(m.percepcionesIva) : null,
        percepcionesIibb: m.percepcionesIibb != null ? Number(m.percepcionesIibb) : null,
        otrosTributos: m.otrosTributos != null ? Number(m.otrosTributos) : null,
        lineas: m.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId ?? null,
          proyectoId: l.proyectoId ?? null,
          porcentaje: Number(l.porcentaje),
        })),
      };
    }),
    recibos: recibos.map((r) => ({
      anio: r.periodo.anio,
      mes: r.periodo.mes,
      costoTotalEmpleador: r.costoTotalEmpleador != null ? Number(r.costoTotalEmpleador) : null,
      lineas: r.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      })),
    })),
    cargos: lineasCargo.map((l) => {
      const f = l.fecha;
      return {
        anio: f ? f.getUTCFullYear() : l.resumen.periodo.anio,
        mes: f ? f.getUTCMonth() + 1 : l.resumen.periodo.mes,
        motivo: l.motivoIgnorada!,
        monto: Number(l.monto),
      };
    }),
    filtro,
  });

  // Orden de filas por sección: categorías padre y sus hijas indentadas.
  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const ordenar = (mapa: Map<string, number[]>) => {
    const ids = [...mapa.keys()];
    const padres = categorias.filter((c) => !c.padreId && ids.includes(c.id));
    const resto = ids.filter((id) => !padres.some((p) => p.id === id));
    const filas: { id: string; nombre: string; hija: boolean; valores: number[] }[] = [];
    for (const p of padres) {
      filas.push({ id: p.id, nombre: p.nombre, hija: false, valores: mapa.get(p.id)! });
      for (const h of categorias.filter((c) => c.padreId === p.id && resto.includes(c.id))) {
        filas.push({ id: h.id, nombre: h.nombre, hija: true, valores: mapa.get(h.id)! });
      }
    }
    for (const id of resto.filter((id) => !filas.some((f) => f.id === id))) {
      filas.push({ id, nombre: nombreCat.get(id) ?? '?', hija: Boolean(categorias.find((c) => c.id === id)?.padreId), valores: mapa.get(id)! });
    }
    return filas;
  };

  const linkCelda = (m: { anio: number; mes: number }, categoriaId?: string) => {
    const desde = `${m.anio}-${String(m.mes).padStart(2, '0')}-01`;
    const ultimo = new Date(Date.UTC(m.anio, m.mes, 0)).getUTCDate();
    const hasta = `${m.anio}-${String(m.mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
    // Drill-down al libro por la dimensión activa ('sin' = líneas sin ese
    // dato; para centro de costo no existe: toda línea tiene centro).
    const drill = !filtro
      ? ''
      : filtro.campo === 'proyectoId'
        ? `&proyectoId=${filtro.valor ?? 'sin'}`
        : filtro.campo === 'clienteId'
          ? `&clienteId=${filtro.valor ?? 'sin'}`
          : filtro.valor
            ? `&centroCostoId=${filtro.valor}`
            : '';
    return `${base}/movimientos?desde=${desde}&hasta=${hasta}${categoriaId ? `&categoriaId=${categoriaId}` : ''}${drill}`;
  };
  const linkEjercicio = (e: number) => `${base}/reportes?ejercicio=${e}${vistaParam ? `&vista=${vistaParam}` : ''}`;
  const DIMENSIONES = [
    { pref: 'p', etiqueta: 'Proyecto', sinEtiqueta: 'Sin proyecto', items: proyectos },
    { pref: 'cc', etiqueta: 'Centro de costo', sinEtiqueta: 'Sin distribución', items: centros },
    { pref: 'cl', etiqueta: 'Cliente', sinEtiqueta: 'Sin cliente', items: clientes },
  ] as { pref: string; etiqueta: string; sinEtiqueta: string; items: { id: string; nombre: string; activo: boolean }[] }[];
  const dimActiva = vistaParam ? DIMENSIONES.find((d) => vistaParam.startsWith(`${d.pref}:`)) : undefined;
  const nombreVista = !filtro || !dimActiva
    ? undefined
    : filtro.valor === null
      ? dimActiva.sinEtiqueta
      : dimActiva.items.find((i) => i.id === filtro!.valor)?.nombre;

  const total = (valores: number[]) => valores.reduce((a, v) => a + v, 0);
  const Celdas = ({ valores, categoriaId, negrita }: { valores: number[]; categoriaId?: string; negrita?: boolean }) => (
    <>
      {valores.map((v, i) => (
        <td key={i} className={`text-right tabular-nums whitespace-nowrap ${negrita ? 'font-semibold' : ''} ${v < 0 ? 'text-red-700' : ''}`}>
          {v !== 0 && categoriaId ? (
            <Link href={linkCelda(meses[i], categoriaId)} className="hover:underline">{fmt(v)}</Link>
          ) : (
            fmt(v)
          )}
        </td>
      ))}
      <td className={`text-right tabular-nums whitespace-nowrap border-l border-slate-200 ${negrita ? 'font-semibold' : ''} ${total(valores) < 0 ? 'text-red-700' : ''}`}>
        {fmt(total(valores))}
      </td>
    </>
  );
  const FilaSeccion = ({ titulo }: { titulo: string }) => (
    <tr>
      <td colSpan={meses.length + 2} className="sticky left-0 bg-slate-50 font-semibold text-slate-700">{titulo}</td>
    </tr>
  );

  return (
    <div>
      <PageHeader
        titulo={nombreVista ? `Reporte P&L — ${nombreVista}` : 'Reporte P&L'}
        descripcion={
          nombreVista && dimActiva
            ? `Porción de ${dimActiva.etiqueta.toLowerCase()} según las líneas de asignación, en pesos y a valores netos.`
            : 'Resultado por categoría y mes, en pesos y a valores netos. Los impuestos indirectos van como memo debajo del resultado.'
        }
      />

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Link href={linkEjercicio(ejercicio - 1)} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">
          Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {inicio === 1 ? ejercicio : ejercicio + 1})
        </span>
        <Link href={linkEjercicio(ejercicio + 1)} className="btn-secondary text-xs">→</Link>
        <form method="get" className="flex items-center gap-1 ml-2">
          <input type="hidden" name="ejercicio" value={ejercicio} />
          <label className="text-xs text-slate-500" htmlFor="vista">Vista</label>
          {/* key: los selects no controlados no toman defaultValue al navegar client-side */}
          <select key={vistaParam ?? 'todos'} id="vista" name="vista" defaultValue={vistaParam ?? ''} className="input text-xs w-auto">
            <option value="">P&L completo</option>
            {DIMENSIONES.map((d) => (
              <optgroup key={d.pref} label={d.etiqueta}>
                {d.items.map((i) => (
                  <option key={i.id} value={`${d.pref}:${i.id}`}>{i.nombre}{i.activo ? '' : ' (inactivo)'}</option>
                ))}
                <option value={`${d.pref}:sin`}>{d.sinEtiqueta}</option>
              </optgroup>
            ))}
          </select>
          <button className="btn-secondary text-xs">Ver</button>
        </form>
        <span className="text-xs text-slate-400 ml-2">montos netos en $ · click en una celda abre el detalle</span>
      </div>

      <div className="card overflow-x-auto mt-4">
        <table className="table-base text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 min-w-56"></th>
              {meses.map((m) => (
                <th key={`${m.anio}-${m.mes}`} className="text-right whitespace-nowrap">
                  {MES_LABEL[m.mes].slice(0, 3)} {String(m.anio).slice(2)}
                </th>
              ))}
              <th className="text-right whitespace-nowrap border-l border-slate-200">Total</th>
            </tr>
          </thead>
          <tbody>
            <FilaSeccion titulo="Ingresos" />
            {ordenar(pnl.ingresos).map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className={`sticky left-0 bg-white whitespace-nowrap ${f.hija ? 'pl-8' : 'pl-6'}`}>{f.nombre}</td>
                <Celdas valores={f.valores} categoriaId={f.id} />
              </tr>
            ))}
            <tr className="bg-slate-50/50">
              <td className="sticky left-0 bg-slate-50/50 pl-6 font-medium">Total ingresos</td>
              <Celdas valores={pnl.subtotalIngresos} negrita />
            </tr>

            <FilaSeccion titulo="Egresos operativos" />
            {ordenar(pnl.egresos).map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className={`sticky left-0 bg-white whitespace-nowrap ${f.hija ? 'pl-8' : 'pl-6'}`}>{f.nombre}</td>
                <Celdas valores={f.valores} categoriaId={f.id} />
              </tr>
            ))}
            <tr className="bg-slate-50/50">
              <td className="sticky left-0 bg-slate-50/50 pl-6 font-medium">Total egresos</td>
              <Celdas valores={pnl.subtotalEgresos} negrita />
            </tr>

            <FilaSeccion titulo="Costos de personal" />
            <tr className="hover:bg-slate-50">
              <td className="sticky left-0 bg-white pl-6">Sueldos y cargas (recibos)</td>
              <Celdas valores={pnl.sueldos} />
            </tr>
            {ordenar(pnl.personal).map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">{f.nombre}</td>
                <Celdas valores={f.valores} categoriaId={f.id} />
              </tr>
            ))}
            <tr className="bg-slate-50/50">
              <td className="sticky left-0 bg-slate-50/50 pl-6 font-medium">Total personal</td>
              <Celdas valores={pnl.subtotalPersonal} negrita />
            </tr>

            {pnl.cargos.size > 0 && (<>
              <FilaSeccion titulo="Cargos de resúmenes" />
              {[...pnl.cargos.entries()].map(([motivo, valores]) => (
                <tr key={motivo} className="hover:bg-slate-50">
                  <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">{motivo}</td>
                  <Celdas valores={valores} />
                </tr>
              ))}
              <tr className="bg-slate-50/50">
                <td className="sticky left-0 bg-slate-50/50 pl-6 font-medium">Total cargos de resúmenes</td>
                <Celdas valores={pnl.subtotalCargos} negrita />
              </tr>
            </>)}

            {pnl.sinCategoria.some((v) => v !== 0) && (
              <tr className="text-amber-700">
                <td className="sticky left-0 bg-white pl-6">Sin categoría (revisar)</td>
                <Celdas valores={pnl.sinCategoria} />
              </tr>
            )}
            {pnl.sinDistribucion.some((v) => v !== 0) && (
              <tr className="text-amber-700">
                <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">Sin distribución (revisar)</td>
                <Celdas valores={pnl.sinDistribucion} />
              </tr>
            )}

            <tr className="border-t-2 border-slate-300 bg-slate-100">
              <td className="sticky left-0 bg-slate-100 font-semibold">RESULTADO DEL PERÍODO</td>
              <Celdas valores={pnl.resultado} negrita />
            </tr>
            <tr className="text-slate-500">
              <td className="sticky left-0 bg-white pl-6">% margen sobre ingresos</td>
              {pnl.resultado.map((v, i) => (
                <td key={i} className="text-right tabular-nums">
                  {pnl.subtotalIngresos[i] > 0 ? `${((v / pnl.subtotalIngresos[i]) * 100).toFixed(1)}%` : '—'}
                </td>
              ))}
              <td className="text-right tabular-nums border-l border-slate-200">
                {total(pnl.subtotalIngresos) > 0
                  ? `${((pnl.totalEjercicio.resultado / total(pnl.subtotalIngresos)) * 100).toFixed(1)}%`
                  : '—'}
              </td>
            </tr>

            {!filtro && (<>
            <FilaSeccion titulo="Memo: impuestos indirectos (no integran el resultado)" />
            {(
              [
                ['IVA débito fiscal (ventas)', pnl.memo.ivaDebito],
                ['IVA crédito fiscal (compras)', pnl.memo.ivaCredito],
                ['Posición neta de IVA', pnl.memo.posicionIva],
                ['Percepciones de IVA', pnl.memo.percepcionesIva],
                ['Percepciones IIBB', pnl.memo.percepcionesIibb],
                ['Otros tributos', pnl.memo.otrosTributos],
              ] as [string, number[]][]
            ).map(([titulo, valores]) => (
              <tr key={titulo} className="text-slate-500 hover:bg-slate-50">
                <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">{titulo}</td>
                <Celdas valores={valores} />
              </tr>
            ))}
            {[...pnl.memo.porCategoria.entries()].map(([catId, valores]) => (
              <tr key={catId} className="text-slate-500 hover:bg-slate-50">
                <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">{nombreCat.get(catId) ?? '?'}</td>
                <Celdas valores={valores} categoriaId={catId} />
              </tr>
            ))}
            </>)}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Sólo computan movimientos ASIGNADOS y recibos confirmados, a valores netos (sin IVA, percepciones ni
          tributos) y en pesos (moneda extranjera × tipo de cambio; sin TC no computa). Las prepagas figuran por su
          neto dentro de Costos de personal. Los cargos de resúmenes son líneas ignoradas en conciliación con motivo
          que afecta el resultado ({MOTIVOS_IGNORO_PNL.join(', ')}), por su monto del resumen.
          {filtro &&
            ' La porción sale de las líneas de asignación (reparto al centavo): la suma de todos los valores de la dimensión más su "sin" reproduce el total. El IVA es del comprobante, por eso el memo de impuestos no aplica en esta vista.'}
        </p>
      </div>
    </div>
  );
}
