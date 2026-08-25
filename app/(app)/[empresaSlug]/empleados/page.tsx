import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha } from '@/lib/periodos';
import { formatMoney } from '@/lib/format';
import { RecibosUpload } from '@/components/recibos-upload';
import { OkBanner } from '@/components/error-banner';

// Sección Empleados (sólo ADMINISTRADOR): checklist y costo por período.
export default async function EmpleadosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { anio?: string; mes?: string; tab?: string; ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const hoy = periodoDeFecha(new Date());
  const anio = Number(searchParams.anio ?? hoy.anio);
  const mes = Number(searchParams.mes ?? hoy.mes);
  const tab = searchParams.tab === 'pendientes' ? 'pendientes' : 'periodo';

  const [empleados, recibosPeriodo, pendientes, jobsFallados, jobsEnCola] = await Promise.all([
    ctx.db.empleado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.reciboSueldo.findMany({
      where: { periodo: { anio, mes }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
      include: { empleado: true },
    }),
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

  // Vinculados del período: monto por empleado de movimientos ASIGNADOS del mes.
  const vinculos = await ctx.db.movimientoEmpleado.findMany({
    where: { movimiento: { estado: 'ASIGNADO', periodo: { anio, mes } } },
  });
  const vinculadoPorEmpleado = new Map<string, number>();
  for (const v of vinculos) {
    vinculadoPorEmpleado.set(v.empleadoId, (vinculadoPorEmpleado.get(v.empleadoId) ?? 0) + Number(v.monto));
  }
  const recibosPorEmpleado = new Map<string, { confirmado: number; pendiente: boolean }>();
  for (const r of recibosPeriodo) {
    const acc = recibosPorEmpleado.get(r.empleadoId) ?? { confirmado: 0, pendiente: false };
    if (r.estado === 'CONFIRMADO') acc.confirmado += Number(r.costoTotalEmpleador ?? 0);
    else acc.pendiente = true;
    recibosPorEmpleado.set(r.empleadoId, acc);
  }
  const costoTotal =
    [...recibosPorEmpleado.values()].reduce((a, r) => a + r.confirmado, 0) +
    [...vinculadoPorEmpleado.values()].reduce((a, v) => a + v, 0);

  const mesAnterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const mesSiguiente = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
  const base = `/${params.empresaSlug}/empleados`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Empleados</h1>
          <p className="text-xs text-slate-500">Costo de personal por período. Sólo administradores ven esta sección.</p>
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

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-500">Costo total de personal · {MES_LABEL[mes]} {anio}</p>
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

      <div className="flex items-center gap-2">
        <Link href={`${base}?anio=${mesAnterior.anio}&mes=${mesAnterior.mes}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">{MES_LABEL[mes]} {anio}</span>
        <Link href={`${base}?anio=${mesSiguiente.anio}&mes=${mesSiguiente.mes}`} className="btn-secondary text-xs">→</Link>
        <span className="mx-2 text-slate-300">|</span>
        <Link href={`${base}?anio=${anio}&mes=${mes}`} className={`text-sm ${tab === 'periodo' ? 'font-semibold underline' : 'text-slate-500'}`}>Período</Link>
        <Link href={`${base}?tab=pendientes`} className={`text-sm ${tab === 'pendientes' ? 'font-semibold underline' : 'text-slate-500'}`}>
          Pendientes {pendientes.length > 0 && `(${pendientes.length})`}
        </Link>
      </div>

      {tab === 'periodo' ? (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Empleado</th><th>Categoría / sector</th><th className="text-right">Recibos</th><th className="text-right">Vinculados</th><th className="text-right">Costo total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {empleados.map((e) => {
                const r = recibosPorEmpleado.get(e.id);
                const vinc = vinculadoPorEmpleado.get(e.id) ?? 0;
                const total = (r?.confirmado ?? 0) + vinc;
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td><Link href={`${base}/${e.id}`} className="font-medium hover:underline">{e.nombre}</Link></td>
                    <td className="text-xs text-slate-500">{[e.categoria, e.sector].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="num">{r?.confirmado ? formatMoney(r.confirmado) : '—'}</td>
                    <td className="num">{vinc ? formatMoney(vinc) : '—'}</td>
                    <td className="num font-medium">{total ? formatMoney(total) : '—'}</td>
                    <td className="text-xs">{r?.pendiente ? '⏳ pendiente' : r?.confirmado ? '✔ confirmado' : '— sin recibo'}</td>
                  </tr>
                );
              })}
              {empleados.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 py-8">Sin empleados: subí el PDF de recibos para darlos de alta.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
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
      )}
    </div>
  );
}
