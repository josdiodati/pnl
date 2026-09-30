import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { formatMoney, formatFecha } from '@/lib/format';
import { netoComputable } from '@/lib/empleados/prepaga';
import { costosDelMes, correspondeAlMes, totalEmpleadoMes, ultimoPeriodoConRecibos, type CostoEmpleadoMes } from '@/lib/empleados/mes';
import { armarMatrizPersonal, type SerieMatriz } from '@/lib/empleados/matriz';
import { RecibosUpload } from '@/components/recibos-upload';
import { OkBanner } from '@/components/error-banner';
import { ArchivosRecibosVista } from './archivos-vista';

// Sección Empleados (sólo ADMINISTRADOR). Vista por defecto: el listado de
// empleados (activos = sin fecha de egreso / inactivos) con el costo del último
// período con recibos. Pestaña Ejercicio: la matriz del ejercicio contable
// (columnas = meses, filas = métricas por centro); cada celda linkea al detalle
// mensual filtrado por centro.

type Busqueda = {
  vista?: string;
  ejercicio?: string;
  anio?: string;
  mes?: string;
  centro?: string;
  tab?: string;
  ok?: string;
  error?: string;
};

const SECCIONES: { clave: 'headcount' | 'netos' | 'retenciones' | 'cargas' | 'sacOtros' | 'prepagas' | 'vinculados' | 'costoTotal'; titulo: string; dinero: boolean; memo?: boolean }[] = [
  { clave: 'headcount', titulo: 'Headcount', dinero: false },
  { clave: 'netos', titulo: 'Sueldos netos', dinero: true },
  { clave: 'retenciones', titulo: 'Retenciones (aportes del empleado)', dinero: true },
  { clave: 'cargas', titulo: 'Cargas sociales (patronales)', dinero: true },
  { clave: 'sacOtros', titulo: 'SAC / otros recibos (incluido arriba)', dinero: true, memo: true },
  { clave: 'prepagas', titulo: 'Prepagas (asignadas)', dinero: true },
  { clave: 'vinculados', titulo: 'Vinculados', dinero: true },
  { clave: 'costoTotal', titulo: 'Costo total empleador', dinero: true },
];

const fmtDinero = (centavos: number) =>
  centavos === 0 ? '—' : (centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtHc = (v: number) =>
  v === 0 ? '—' : Number.isInteger(Math.round(v * 100) / 100) ? String(Math.round(v)) : v.toLocaleString('es-AR', { maximumFractionDigits: 1 });

const estadoRecibo = (c: CostoEmpleadoMes | undefined) =>
  c?.pendiente ? '⏳ pendiente' : c?.recibos ? '✔ confirmado' : '— sin recibo';

export default async function EmpleadosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: Busqueda;
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const base = `/${params.empresaSlug}/empleados`;
  const hoy = periodoDeFecha(new Date());
  const inicio = ctx.empresa.inicioEjercicioFiscal;

  const vista =
    searchParams.tab === 'pendientes' || searchParams.vista === 'pendientes'
      ? 'pendientes'
      : searchParams.vista === 'detalle'
        ? 'detalle'
        : searchParams.vista === 'archivos'
          ? 'archivos'
          : searchParams.vista === 'ejercicio' || searchParams.ejercicio
            ? 'ejercicio'
            : 'empleados';
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioDeMes(hoy.anio, hoy.mes, inicio));
  const anio = Number(searchParams.anio ?? hoy.anio);
  const mes = Number(searchParams.mes ?? hoy.mes);
  const centroFiltro = searchParams.centro || null;

  const [centros, pendientes, jobsFallados, jobsEnCola] = await Promise.all([
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.reciboSueldo.findMany({
      where: { estado: 'PENDIENTE_REVISION' },
      include: { empleado: true, periodo: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.job.findMany({
      where: { tipo: 'EXTRACCION_RECIBO', empresaId: ctx.empresa.id, estado: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.job.count({
      where: { tipo: 'EXTRACCION_RECIBO', empresaId: ctx.empresa.id, estado: { in: ['queued', 'processing'] } },
    }),
  ]);

  const encabezado = (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Empleados</h1>
          <p className="text-xs text-slate-500">Costo de personal del ejercicio. Sólo administradores ven esta sección.</p>
        </div>
        <RecibosUpload empresaSlug={params.empresaSlug} />
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
      {jobsEnCola > 0 && (
        <p className="text-sm text-amber-600">⏳ {jobsEnCola} página{jobsEnCola !== 1 ? 's' : ''} de recibos en procesamiento… (actualizá para ver el avance)</p>
      )}
      {jobsFallados.length > 0 && (
        <div className="card p-3 border-red-200">
          <p className="text-sm font-medium text-red-700">Páginas con error de procesamiento</p>
          {jobsFallados.map((j) => (
            <p key={j.id} className="text-xs text-red-600">
              Página {(j.payload as { pagina?: number }).pagina ?? '?'}: {j.error}
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={base} className={`text-sm ${vista === 'empleados' ? 'font-semibold underline' : 'text-slate-500'}`}>Empleados</Link>
        <Link href={`${base}?vista=ejercicio`} className={`text-sm ${vista === 'ejercicio' ? 'font-semibold underline' : 'text-slate-500'}`}>Ejercicio</Link>
        <Link href={`${base}?vista=detalle&anio=${anio}&mes=${mes}`} className={`text-sm ${vista === 'detalle' ? 'font-semibold underline' : 'text-slate-500'}`}>Detalle mensual</Link>
        <Link href={`${base}?vista=pendientes`} className={`text-sm ${vista === 'pendientes' ? 'font-semibold underline' : 'text-slate-500'}`}>
          Pendientes {pendientes.length > 0 && `(${pendientes.length})`}
        </Link>
        <Link href={`${base}?vista=archivos`} className={`text-sm ${vista === 'archivos' ? 'font-semibold underline' : 'text-slate-500'}`}>
          Archivos
        </Link>
      </div>
    </>
  );

  // ---------- Vista: empleados (default) ----------
  // Todos los empleados, activos (sin fecha de egreso) e inactivos, con el
  // costo del último período del que hay recibos.
  if (vista === 'empleados') {
    const [todos, ultimo] = await Promise.all([
      ctx.db.empleado.findMany({
        orderBy: { nombre: 'asc' },
        include: { distribucion: { include: { centroCosto: true, cliente: true, proyecto: true } } },
      }),
      ultimoPeriodoConRecibos(ctx.db),
    ]);
    const costos = ultimo ? await costosDelMes(ctx.db, ultimo.anio, ultimo.mes) : new Map<string, CostoEmpleadoMes>();
    const activos = todos.filter((e) => !e.fechaEgreso);
    const inactivos = todos.filter((e) => e.fechaEgreso);
    const costoMes = [...costos.values()].reduce((a, c) => a + totalEmpleadoMes(c), 0);
    const activosConRecibo = activos.filter((e) => costos.get(e.id)?.tieneRecibo).length;
    const periodoLabel = ultimo ? `${MES_LABEL[ultimo.mes]} ${ultimo.anio}` : 'sin recibos';

    const tabla = (lista: typeof todos, inactivo: boolean) => (
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Categoría / sector</th>
              <th>Asignación</th>
              <th>{inactivo ? 'Ingreso / egreso' : 'Ingreso'}</th>
              <th className="text-right">Recibos</th>
              <th className="text-right">Vinculados</th>
              <th className="text-right" title="Neto de la prepaga asignada (plan − % × aportes+contribuciones); se carga en Personal → Prepagas">Prepaga</th>
              <th className="text-right">Costo total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => {
              const c = costos.get(e.id);
              const total = totalEmpleadoMes(c);
              return (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td><Link href={`${base}/${e.id}`} className="font-medium hover:underline">{e.nombre}</Link></td>
                  <td className="text-xs text-slate-500">{[e.categoria, e.sector].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="text-xs">
                    {e.distribucion.length === 0
                      ? <span className="text-amber-700">sin asignar</span>
                      : e.distribucion.map((l) => (
                          <span key={l.id} className="block">
                            {[l.centroCosto.nombre, l.cliente?.nombre, l.proyecto?.nombre].filter(Boolean).join(' › ')}
                            {Number(l.porcentaje) !== 100 && <span className="text-slate-500"> {Number(l.porcentaje)}%</span>}
                          </span>
                        ))}
                  </td>
                  <td className="text-xs tabular-nums">
                    {formatFecha(e.fechaIngreso)}
                    {inactivo && <> / {formatFecha(e.fechaEgreso)}</>}
                  </td>
                  <td className="num">{c?.recibos ? formatMoney(c.recibos) : '—'}</td>
                  <td className="num">{c?.vinculado ? formatMoney(c.vinculado) : '—'}</td>
                  <td className="num">{c?.prepaga ? formatMoney(c.prepaga) : '—'}</td>
                  <td className="num font-medium">{total ? formatMoney(total) : '—'}</td>
                  <td className="text-xs">
                    {!c && ultimo && !correspondeAlMes(e, ultimo.anio, ultimo.mes) ? <span className="text-slate-400">egresado</span> : estadoRecibo(c)}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-8">
                {inactivo ? 'No hay empleados con fecha de egreso.' : 'Sin empleados: subí el PDF de recibos para darlos de alta.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    );

    return (
      <div className="space-y-4">
        {encabezado}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="card p-3">
            <p className="text-xs text-slate-500">Costo total de personal · {periodoLabel}</p>
            <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoney(costoMes)}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">Activos con recibo · {periodoLabel}</p>
            <p className="text-xl font-semibold tabular-nums">{activosConRecibo} / {activos.length}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">Pendientes de revisión (todos los períodos)</p>
            <p className="text-xl font-semibold tabular-nums">{pendientes.length}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Costos del último período con recibos ({periodoLabel}).
          {ultimo && <> <Link href={`${base}?vista=detalle&anio=${ultimo.anio}&mes=${ultimo.mes}`} className="underline">Ver otros meses</Link></>}
        </p>
        <h2 className="text-sm font-semibold">Activos ({activos.length})</h2>
        {tabla(activos, false)}
        <h2 className="text-sm font-semibold">Inactivos ({inactivos.length})</h2>
        {tabla(inactivos, true)}
      </div>
    );
  }

  // ---------- Vista: archivos subidos (log) ----------
  if (vista === 'archivos') {
    return (
      <div className="space-y-4">
        {encabezado}
        <ArchivosRecibosVista empresaId={ctx.empresa.id} base={base} />
      </div>
    );
  }

  // ---------- Vista: pendientes ----------
  if (vista === 'pendientes') {
    return (
      <div className="space-y-4">
        {encabezado}
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Empleado</th><th>Período</th><th>Tipo</th><th className="text-right">Costo total</th><th>Motivos</th><th /></tr>
            </thead>
            <tbody>
              {pendientes.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="font-medium">{r.empleado.nombre}</td>
                  <td>{MES_LABEL[r.periodo.mes]} {r.periodo.anio}</td>
                  <td className="text-xs">{r.tipo}</td>
                  <td className="num">{r.costoTotalEmpleador ? formatMoney(Number(r.costoTotalEmpleador)) : '—'}</td>
                  <td className="text-xs text-amber-700">
                    {r.nota ? `${r.nota}. ` : ''}
                    {Object.values((r.camposRevisar as Record<string, string> | null) ?? {}).join(' · ')}
                  </td>
                  <td><Link href={`${base}/recibos/${r.id}`} className="btn-secondary text-xs">Revisar</Link></td>
                </tr>
              ))}
              {pendientes.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 py-8">Nada pendiente de revisión.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ---------- Vista: detalle mensual (con filtro por centro) ----------
  if (vista === 'detalle') {
    const [todos, costos] = await Promise.all([
      ctx.db.empleado.findMany({ orderBy: { nombre: 'asc' } }),
      costosDelMes(ctx.db, anio, mes, centroFiltro),
    ]);
    // Los egresados antes de este mes no se listan como "sin recibo" (su
    // último recibo es el del mes de egreso); quien tenga costo acá, siempre.
    const empleados = todos.filter((e) => costos.has(e.id) || (e.activo && correspondeAlMes(e, anio, mes)));

    // Filtro por centro (viene del drill-down de la matriz).
    const filtrados = empleados.filter((e) => {
      if (!centroFiltro) return true;
      const c = costos.get(e.id);
      if (!c?.tieneRecibo) return false;
      return centroFiltro === 'SIN_ASIGNAR' ? c.pendiente : c.centros.has(centroFiltro);
    });
    const idsFiltrados = new Set(filtrados.map((e) => e.id));
    const costoTotal = [...costos.entries()].reduce(
      (acc, [id, c]) => acc + (idsFiltrados.has(id) || !centroFiltro ? totalEmpleadoMes(c) : 0),
      0,
    );
    const conRecibo = [...costos.values()].filter((c) => c.tieneRecibo).length;
    const mesAnterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
    const mesSiguiente = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
    const qsCentro = centroFiltro ? `&centro=${centroFiltro}` : '';
    const nombreCentro =
      centroFiltro === 'SIN_ASIGNAR' ? 'Sin asignar' : centros.find((c) => c.id === centroFiltro)?.nombre;

    return (
      <div className="space-y-4">
        {encabezado}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="card p-3">
            <p className="text-xs text-slate-500">
              Costo total de personal · {MES_LABEL[mes]} {anio}{nombreCentro ? ` · ${nombreCentro}` : ''}
            </p>
            <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoney(costoTotal)}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">Empleados con recibo</p>
            <p className="text-xl font-semibold tabular-nums">{conRecibo} / {empleados.length}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-slate-500">Pendientes de revisión (todos los períodos)</p>
            <p className="text-xl font-semibold tabular-nums">{pendientes.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`${base}?vista=detalle&anio=${mesAnterior.anio}&mes=${mesAnterior.mes}${qsCentro}`} className="btn-secondary text-xs">←</Link>
          <span className="text-sm font-medium">{MES_LABEL[mes]} {anio}</span>
          <Link href={`${base}?vista=detalle&anio=${mesSiguiente.anio}&mes=${mesSiguiente.mes}${qsCentro}`} className="btn-secondary text-xs">→</Link>
          {nombreCentro && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-100 text-sky-800 px-2 py-0.5 text-xs font-medium">
              Centro: {nombreCentro}
              <Link href={`${base}?vista=detalle&anio=${anio}&mes=${mes}`} className="underline">quitar</Link>
            </span>
          )}
        </div>

        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Categoría / sector</th>
                <th className="text-right">Recibos{nombreCentro && centroFiltro !== 'SIN_ASIGNAR' ? ' (porción)' : ''}</th>
                <th className="text-right">Vinculados{nombreCentro && centroFiltro !== 'SIN_ASIGNAR' ? ' (porción)' : ''}</th>
                <th className="text-right" title="Neto de la prepaga asignada (plan − % × aportes+contribuciones); se carga en Personal → Prepagas">Prepaga</th>
                <th className="text-right">Costo total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => {
                const c = costos.get(e.id);
                const vinc = c?.vinculado ?? 0;
                const prep = c?.prepaga ?? 0;
                const total = totalEmpleadoMes(c);
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td><Link href={`${base}/${e.id}`} className="font-medium hover:underline">{e.nombre}</Link></td>
                    <td className="text-xs text-slate-500">{[e.categoria, e.sector].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="num">{c?.recibos ? formatMoney(c.recibos) : '—'}</td>
                    <td className="num">{vinc ? formatMoney(vinc) : '—'}</td>
                    <td className="num">{prep ? formatMoney(prep) : '—'}</td>
                    <td className="num font-medium">{total ? formatMoney(total) : '—'}</td>
                    <td className="text-xs">{estadoRecibo(c)}</td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-400 py-8">
                  {centroFiltro ? 'Sin empleados en ese centro para este mes.' : 'Sin empleados: subí el PDF de recibos para darlos de alta.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ---------- Vista: matriz del ejercicio ----------
  const meses = mesesDeEjercicio(ejercicio, inicio);
  const periodos = await ctx.db.periodo.findMany({
    where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
  });
  const periodoIds = periodos.map((p) => p.id);
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const [recibosEj, prepagasEj, vincsEj] = await Promise.all([
    ctx.db.reciboSueldo.findMany({
      where: { periodoId: { in: periodoIds }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
      include: { lineas: true },
    }),
    // Prepagas ASIGNADAS por empleado (gestión): sólo lo asignado computa acá;
    // las facturas agregadas quedan en el libro.
    ctx.db.prepagaEmpleado.findMany({
      where: { periodoId: { in: periodoIds } },
      include: { empleado: { include: { distribucion: true } } },
    }),
    ctx.db.movimientoEmpleado.findMany({
      where: {
        movimiento: {
          estado: 'ASIGNADO',
          periodoId: { in: periodoIds },
          OR: [{ categoriaId: null }, { categoria: { esCostoPersonal: false } }],
        },
      },
      include: { movimiento: true, empleado: { include: { distribucion: true } } },
    }),
  ]);

  const num = (v: unknown) => (v == null ? null : Number(v));
  const matriz = armarMatrizPersonal({
    meses,
    recibos: recibosEj.map((r) => {
      const p = periodoPorId.get(r.periodoId)!;
      return {
        anio: p.anio,
        mes: p.mes,
        tipo: r.tipo,
        estado: r.estado as 'CONFIRMADO' | 'PENDIENTE_REVISION',
        empleadoId: r.empleadoId,
        sueldoNeto: num(r.sueldoNeto),
        retenciones: num(r.retenciones),
        contribucionesEmpleador: num(r.contribucionesEmpleador),
        costoTotalEmpleador: num(r.costoTotalEmpleador),
        lineas: r.lineas.map((l) => ({ centroCostoId: l.centroCostoId, porcentaje: Number(l.porcentaje) })),
      };
    }),
    prepagas: prepagasEj
      .map((r) => {
        const p = periodoPorId.get(r.periodoId)!;
        return {
          anio: p.anio,
          mes: p.mes,
          centavos: netoComputable({
            costoPlan: Number(r.costoPlan),
            aportes: Number(r.aportes),
            contribuciones: Number(r.contribuciones),
            fsrPct: Number(r.fsrPct),
          }),
          lineas: r.empleado.distribucion.map((l) => ({ centroCostoId: l.centroCostoId, porcentaje: Number(l.porcentaje) })),
        };
      })
      .filter((x) => x.centavos > 0),
    vinculados: vincsEj.map((v) => {
      const p = periodoPorId.get(v.movimiento.periodoId!)!;
      return {
        anio: p.anio,
        mes: p.mes,
        centavos: Math.round(Number(v.monto) * 100),
        lineas: v.empleado.distribucion.map((l) => ({ centroCostoId: l.centroCostoId, porcentaje: Number(l.porcentaje) })),
      };
    }),
  });

  const linkCelda = (m: { anio: number; mes: number }, centro?: string) =>
    `${base}?vista=detalle&anio=${m.anio}&mes=${m.mes}${centro ? `&centro=${centro}` : ''}`;

  const filasDe = (serie: SerieMatriz) => {
    const filas: { etiqueta: string; centro?: string; valores: number[]; esTotal?: boolean }[] = [];
    for (const c of centros) {
      const valores = serie.porCentro.get(c.id);
      if (valores && valores.some((v) => v !== 0)) filas.push({ etiqueta: c.nombre, centro: c.id, valores });
    }
    if (serie.sinAsignar.some((v) => v !== 0)) filas.push({ etiqueta: 'Sin asignar', centro: 'SIN_ASIGNAR', valores: serie.sinAsignar });
    filas.push({ etiqueta: 'Total', valores: serie.total, esTotal: true });
    return filas;
  };

  return (
    <div className="space-y-4">
      {encabezado}
      <div className="flex items-center gap-2">
        <Link href={`${base}?vista=ejercicio&ejercicio=${ejercicio - 1}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">
          Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {inicio === 1 ? ejercicio : ejercicio + 1})
        </span>
        <Link href={`${base}?vista=ejercicio&ejercicio=${ejercicio + 1}`} className="btn-secondary text-xs">→</Link>
        <span className="text-xs text-slate-400 ml-2">montos en $ · click en una celda para ver el detalle</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 min-w-52"></th>
              {meses.map((m) => (
                <th key={`${m.anio}-${m.mes}`} className="text-right whitespace-nowrap">
                  {MES_LABEL[m.mes].slice(0, 3)} {String(m.anio).slice(2)}
                </th>
              ))}
            </tr>
          </thead>
          {SECCIONES.map((s) => {
            const serie = matriz[s.clave];
            const filas = filasDe(serie);
            const sinDatos = filas.length === 1 && filas[0].valores.every((v) => v === 0);
            if (sinDatos && s.memo) return null;
            return (
              <tbody key={s.clave} className="border-t border-slate-200">
                <tr>
                  <td colSpan={meses.length + 1} className={`sticky left-0 bg-slate-50 font-semibold ${s.memo ? 'text-slate-500' : 'text-slate-700'}`}>
                    {s.titulo}
                  </td>
                </tr>
                {filas.map((f) => (
                  <tr key={f.etiqueta} className={f.esTotal ? 'font-medium bg-slate-50/50' : 'hover:bg-slate-50'}>
                    <td className="sticky left-0 bg-white pl-6 whitespace-nowrap">{f.etiqueta}</td>
                    {f.valores.map((v, i) => (
                      <td key={i} className="text-right tabular-nums whitespace-nowrap">
                        {v !== 0 ? (
                          <Link href={linkCelda(meses[i], f.centro)} className="hover:underline">
                            {s.dinero ? fmtDinero(v) : fmtHc(v)}
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Headcount ponderado por la distribución de cada recibo (el total cuenta empleados enteros). «SAC / otros» es
          informativo: ya está incluido en netos, retenciones y cargas. Los pendientes de revisión computan en «Sin asignar».
        </p>
      </div>
    </div>
  );
}
