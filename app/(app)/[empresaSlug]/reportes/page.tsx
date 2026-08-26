import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { armarPnl, type MovimientoPnl } from '@/lib/reportes/pnl';
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
  searchParams: { ejercicio?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const base = `/${params.empresaSlug}`;
  const hoy = periodoDeFecha(new Date());
  const inicio = ctx.empresa.inicioEjercicioFiscal;
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioDeMes(hoy.anio, hoy.mes, inicio));
  const meses = mesesDeEjercicio(ejercicio, inicio);

  const periodos = await ctx.db.periodo.findMany({
    where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
  });
  const periodoIds = periodos.map((p) => p.id);
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const [movimientos, recibos, categorias] = await Promise.all([
    ctx.db.movimiento.findMany({
      where: { estado: 'ASIGNADO', periodoId: { in: periodoIds } },
      include: { categoria: true },
    }),
    ctx.db.reciboSueldo.findMany({
      where: { estado: 'CONFIRMADO', periodoId: { in: periodoIds } },
      include: { periodo: true },
    }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
  ]);

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
      };
    }),
    recibos: recibos.map((r) => ({
      anio: r.periodo.anio,
      mes: r.periodo.mes,
      costoTotalEmpleador: r.costoTotalEmpleador != null ? Number(r.costoTotalEmpleador) : null,
    })),
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
    return `${base}/movimientos?desde=${desde}&hasta=${hasta}${categoriaId ? `&categoriaId=${categoriaId}` : ''}`;
  };

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
        titulo="Reporte P&L"
        descripcion="Resultado por categoría y mes, en pesos y a valores netos. Los impuestos indirectos van como memo debajo del resultado."
      />

      <div className="mt-4 flex items-center gap-2">
        <Link href={`${base}/reportes?ejercicio=${ejercicio - 1}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">
          Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {inicio === 1 ? ejercicio : ejercicio + 1})
        </span>
        <Link href={`${base}/reportes?ejercicio=${ejercicio + 1}`} className="btn-secondary text-xs">→</Link>
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

            {pnl.sinCategoria.some((v) => v !== 0) && (
              <tr className="text-amber-700">
                <td className="sticky left-0 bg-white pl-6">Sin categoría (revisar)</td>
                <Celdas valores={pnl.sinCategoria} />
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
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Sólo computan movimientos ASIGNADOS y recibos confirmados, a valores netos (sin IVA, percepciones ni
          tributos) y en pesos (moneda extranjera × tipo de cambio; sin TC no computa). Las prepagas figuran por su
          neto dentro de Costos de personal.
        </p>
      </div>
    </div>
  );
}
