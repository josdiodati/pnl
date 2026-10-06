import Link from 'next/link';
import { requireReportePage } from '@/lib/reportes-personalizados/acceso';
import { reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { calcularNeteoSocios } from '@/lib/reportes-personalizados/neteo-socios';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { armarPnl, type MesPnl } from '@/lib/reportes/pnl';
import { cargarDatosPnl } from '@/lib/reportes/datos-pnl';
import { PageHeader } from '@/components/page-header';

// Neteo Particulares: lo que cada socio cargó a su proyecto de cuentas
// particulares (Kawellu: GG y JD) y el neteo de cada mes, autocontenido (el
// neteo del año es la columna YTD). Montos = resultado del P&L filtrado por cada proyecto (netos, en
// pesos), así cierra con la vista por proyecto del Reporte P&L.

const ID = 'neteo-socios';
const fmt = (centavos: number) =>
  centavos === 0 ? '—' : (centavos / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function NeteoSociosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ejercicio?: string; a?: string; b?: string };
}) {
  const ctx = await requireReportePage(params.empresaSlug, ID);
  const reporte = reporteDelCatalogo(ID)!;
  const base = `/${params.empresaSlug}`;
  const hoy = periodoDeFecha(new Date());
  const inicio = ctx.empresa.inicioEjercicioFiscal;
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioDeMes(hoy.anio, hoy.mes, inicio));
  const meses = mesesDeEjercicio(ejercicio, inicio);

  const proyectos = await ctx.db.proyecto.findMany({ orderBy: { nombre: 'asc' } });
  const porNombre = (n: string) => proyectos.find((p) => p.nombre.trim().toUpperCase() === n);
  const elegido = (id: string | undefined, nombre: string, i: number) =>
    proyectos.find((p) => p.id === id) ?? porNombre(nombre) ?? proyectos[i];
  const a = elegido(searchParams.a, 'GG', 0);
  const b = elegido(searchParams.b, 'JD', 1);

  const selector = (
    <form method="get" className="flex items-center gap-1 flex-wrap">
      <input type="hidden" name="ejercicio" value={ejercicio} />
      <select key={`a-${a?.id}`} name="a" defaultValue={a?.id} className="input text-xs w-auto" aria-label="Socio A">
        {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      <span className="text-xs text-ink-mute">vs</span>
      <select key={`b-${b?.id}`} name="b" defaultValue={b?.id} className="input text-xs w-auto" aria-label="Socio B">
        {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      <button className="btn-secondary text-xs">Ver</button>
    </form>
  );

  if (!a || !b || a.id === b.id) {
    return (
      <div>
        <PageHeader titulo={reporte.titulo} descripcion={reporte.descripcion} />
        <div className="mt-4">{selector}</div>
        <p className="mt-4 text-sm text-ink-mute">Elegí dos proyectos distintos (uno por socio) para comparar.</p>
      </div>
    );
  }

  // Cada ejercicio arranca en cero: al cierre se netea todo (pedido de José).
  const datos = await cargarDatosPnl(ctx.db, meses);
  const resultado = (proyectoId: string) =>
    armarPnl({ meses, movimientos: datos.movimientosPnl, recibos: datos.recibosPnl, filtro: { campo: 'proyectoId', valor: proyectoId } }).resultado;
  const r = calcularNeteoSocios(resultado(a.id), resultado(b.id));

  const linkEjercicio = (e: number) => `${base}/reportes-personalizados/${ID}?ejercicio=${e}&a=${a.id}&b=${b.id}`;
  // Detalle de una celda: Movimientos de ese proyecto en ese mes (o el ejercicio).
  const linkMovs = (proyectoId: string, desdeM: MesPnl, hastaM: MesPnl) => {
    const ultimo = new Date(Date.UTC(hastaM.anio, hastaM.mes, 0)).getUTCDate();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const sp = new URLSearchParams({
      proyectoId,
      desde: `${desdeM.anio}-${p2(desdeM.mes)}-01`,
      hasta: `${hastaM.anio}-${p2(hastaM.mes)}-${p2(ultimo)}`,
    });
    return `${base}/movimientos?${sp}`;
  };
  const tono = (v: number) => (v < 0 ? 'text-red-700' : v > 0 ? 'text-emerald-700' : '');

  const FilaGasto = ({ nombre, valores, total, proyectoId }: { nombre: string; valores: number[]; total: number; proyectoId: string }) => (
    <tr className="hover:bg-slate-50">
      <td className="sticky left-0 bg-white whitespace-nowrap pl-4">Gastos {nombre}</td>
      <td className="text-right tabular-nums whitespace-nowrap border-r border-slate-200 font-medium">
        {total !== 0 ? <Link href={linkMovs(proyectoId, meses[0], meses[11])} className="hover:underline">{fmt(total)}</Link> : fmt(total)}
      </td>
      {valores.map((v, i) => (
        <td key={i} className="text-right tabular-nums whitespace-nowrap">
          {v !== 0 ? <Link href={linkMovs(proyectoId, meses[i], meses[i])} className="hover:underline">{fmt(v)}</Link> : fmt(v)}
        </td>
      ))}
    </tr>
  );

  return (
    <div>
      <PageHeader
        titulo={reporte.titulo}
        descripcion={`Gastos cargados a ${a.nombre} y a ${b.nombre} y el neteo de cada mes; el del año, en YTD. Montos netos en pesos, como la vista por proyecto del Reporte P&L.`}
        acciones={<Link href={`${base}/reportes-personalizados`} className="btn-secondary">Reportes Personales</Link>}
      />

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Link href={linkEjercicio(ejercicio - 1)} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">
          Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {inicio === 1 ? ejercicio : ejercicio + 1})
        </span>
        <Link href={linkEjercicio(ejercicio + 1)} className="btn-secondary text-xs">→</Link>
        <div className="ml-2">{selector}</div>
      </div>

      <div className="card overflow-x-auto mt-4">
        <table className="table-base text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 min-w-44"></th>
              <th className="text-right whitespace-nowrap border-r border-slate-200">YTD</th>
              {meses.map((m) => (
                <th key={`${m.anio}-${m.mes}`} className="text-right whitespace-nowrap">
                  {MES_LABEL[m.mes].slice(0, 3)} {String(m.anio).slice(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <FilaGasto nombre={a.nombre} valores={r.gastoA} total={r.total.gastoA} proyectoId={a.id} />
            <FilaGasto nombre={b.nombre} valores={r.gastoB} total={r.total.gastoB} proyectoId={b.id} />
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="sticky left-0 bg-slate-50 pl-4">Neteo del mes</td>
              <td className={`text-right tabular-nums whitespace-nowrap border-r border-slate-200 ${tono(r.total.neteo)}`}>{fmt(r.total.neteo)}</td>
              {r.neteo.map((v, i) => (
                <td key={i} className={`text-right tabular-nums whitespace-nowrap ${tono(v)}`}>{fmt(v)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-mute">
        <span className="text-emerald-700 font-medium">Positivo: netea {b.nombre}</span> -{' '}
        <span className="text-red-700 font-medium">Negativo: netea {a.nombre}</span>
      </p>
    </div>
  );
}
