import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { formatMoney } from '@/lib/format';
import { netoComputable } from '@/lib/empleados/prepaga';
import { armarMatrizPersonal, type SerieMatriz } from '@/lib/empleados/matriz';
import { RecibosUpload } from '@/components/recibos-upload';
import { OkBanner } from '@/components/error-banner';

// Sección Empleados (sólo ADMINISTRADOR). Vista por defecto: la matriz del
// ejercicio contable (columnas = meses, filas = métricas por centro de costo).
// Cada celda linkea al detalle mensual filtrado por centro.

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
        : 'ejercicio';
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
        <Link href={base} className={`text-sm ${vista === 'ejercicio' ? 'font-semibold underline' : 'text-slate-500'}`}>Ejercicio</Link>
        <Link href={`${base}?vista=detalle&anio=${anio}&mes=${mes}`} className={`text-sm ${vista === 'detalle' ? 'font-semibold underline' : 'text-slate-500'}`}>Detalle mensual</Link>
        <Link href={`${base}?vista=pendientes`} className={`text-sm ${vista === 'pendientes' ? 'font-semibold underline' : 'text-slate-500'}`}>
          Pendientes {pendientes.length > 0 && `(${pendientes.length})`}
        </Link>
      </div>
    </>
  );

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
    const [empleados, recibosPeriodo, vinculos, prepagasMesRegistros] = await Promise.all([
      ctx.db.empleado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      ctx.db.reciboSueldo.findMany({
        where: { periodo: { anio, mes }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
        include: { empleado: true, lineas: true },
      }),
      ctx.db.movimientoEmpleado.findMany({
        where: { movimiento: { estado: 'ASIGNADO', periodo: { anio, mes } } },
        include: { empleado: { include: { distribucion: true } } },
      }),
      ctx.db.prepagaEmpleado.findMany({
        where: { periodo: { anio, mes } },
        include: { empleado: { include: { distribucion: true } } },
      }),
    ]);

    // Porcentaje de unas líneas que cae en el centro filtrado (1 si no hay filtro).
    const pctEnCentro = (lineas: { centroCostoId: string; porcentaje: unknown }[]) => {
      if (!centroFiltro || centroFiltro === 'SIN_ASIGNAR') return 1;
      return lineas.filter((l) => l.centroCostoId === centroFiltro).reduce((a, l) => a + Number(l.porcentaje), 0) / 100;
    };

    // Con filtro activo, las columnas muestran LA PORCIÓN de ese centro (un
    // empleado repartido 60/40 no aparece por su costo completo) — así la
    // tabla cuadra con la celda de la matriz.
    const vinculadoPorEmpleado = new Map<string, number>();
    for (const v of vinculos) {
      const porcion = Number(v.monto) * pctEnCentro(v.empleado.distribucion);
      vinculadoPorEmpleado.set(v.empleadoId, (vinculadoPorEmpleado.get(v.empleadoId) ?? 0) + porcion);
    }
    const recibosPorEmpleado = new Map<string, { confirmado: number; pendiente: boolean; centros: Set<string> }>();
    for (const r of recibosPeriodo) {
      const acc = recibosPorEmpleado.get(r.empleadoId) ?? { confirmado: 0, pendiente: false, centros: new Set<string>() };
      if (r.estado === 'CONFIRMADO') {
        acc.confirmado += Number(r.costoTotalEmpleador ?? 0) * pctEnCentro(r.lineas);
        for (const l of r.lineas) acc.centros.add(l.centroCostoId);
        if (r.lineas.length === 0) acc.pendiente = true; // confirmado sin líneas: cuenta como sin asignar
      } else acc.pendiente = true;
      recibosPorEmpleado.set(r.empleadoId, acc);
    }

    // Filtro por centro (viene del drill-down de la matriz).
    const filtrados = empleados.filter((e) => {
      if (!centroFiltro) return true;
      const r = recibosPorEmpleado.get(e.id);
      if (!r) return false;
      return centroFiltro === 'SIN_ASIGNAR' ? r.pendiente : r.centros.has(centroFiltro);
    });

    // Prepagas ASIGNADAS por empleado (gestión): la porción del centro sale de
    // la distribución de la ficha; el agregado contable queda en el libro.
    const prepagaPorEmpleado = new Map<string, number>();
    for (const r of prepagasMesRegistros) {
      const neto =
        netoComputable({
          costoPlan: Number(r.costoPlan),
          aportes: Number(r.aportes),
          contribuciones: Number(r.contribuciones),
          fsrPct: Number(r.fsrPct),
        }) / 100;
      const porcion = neto * pctEnCentro(r.empleado.distribucion);
      if (porcion > 0) prepagaPorEmpleado.set(r.empleadoId, (prepagaPorEmpleado.get(r.empleadoId) ?? 0) + porcion);
    }

    const idsFiltrados = new Set(filtrados.map((e) => e.id));
    const sumaFiltrada = (m: Map<string, number>) =>
      [...m.entries()].reduce((a, [id, v]) => a + (idsFiltrados.has(id) || !centroFiltro ? v : 0), 0);
    const costoTotal =
      sumaFiltrada(new Map([...recibosPorEmpleado.entries()].map(([id, r]) => [id, r.confirmado]))) +
      sumaFiltrada(vinculadoPorEmpleado) +
      sumaFiltrada(prepagaPorEmpleado);
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
            <p className="text-xl font-semibold tabular-nums">{recibosPorEmpleado.size} / {empleados.length}</p>
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
                const r = recibosPorEmpleado.get(e.id);
                const vinc = vinculadoPorEmpleado.get(e.id) ?? 0;
                const prep = prepagaPorEmpleado.get(e.id) ?? 0;
                const total = (r?.confirmado ?? 0) + vinc + prep;
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td><Link href={`${base}/${e.id}`} className="font-medium hover:underline">{e.nombre}</Link></td>
                    <td className="text-xs text-slate-500">{[e.categoria, e.sector].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="num">{r?.confirmado ? formatMoney(r.confirmado) : '—'}</td>
                    <td className="num">{vinc ? formatMoney(vinc) : '—'}</td>
                    <td className="num">{prep ? formatMoney(prep) : '—'}</td>
                    <td className="num font-medium">{total ? formatMoney(total) : '—'}</td>
                    <td className="text-xs">{r?.pendiente ? '⏳ pendiente' : r?.confirmado ? '✔ confirmado' : '— sin recibo'}</td>
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
        <Link href={`${base}?ejercicio=${ejercicio - 1}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">
          Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {inicio === 1 ? ejercicio : ejercicio + 1})
        </span>
        <Link href={`${base}?ejercicio=${ejercicio + 1}`} className="btn-secondary text-xs">→</Link>
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
