import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { mesesDeEjercicio, ejercicioDeMes, MES_LABEL } from '@/lib/periodos';
import { signoMovimiento } from '@/lib/movimientos/signo';
import { formatMoneyFirmado } from '@/lib/format';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { cerrarPeriodoAction, reabrirPeriodoAction } from './actions';

// Fiscal-year grid: 12 months with state, validated totals and close/reopen
// actions by role (doc 07).
export default async function PeriodosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ejercicio?: string; error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const esAdmin = rolAlcanza(ctx.rol, 'ADMINISTRADOR');
  const inicio = ctx.empresa.inicioEjercicioFiscal;

  const hoy = new Date();
  const ejercicioActual = ejercicioDeMes(hoy.getFullYear(), hoy.getMonth() + 1, inicio);
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioActual);
  const meses = mesesDeEjercicio(ejercicio, inicio);

  const desde = new Date(Date.UTC(meses[0].anio, meses[0].mes - 1, 1));
  const hasta = new Date(Date.UTC(meses[11].anio, meses[11].mes, 1));

  const [periodos, asignados, pendientes] = await Promise.all([
    ctx.db.periodo.findMany({
      where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
    }),
    ctx.db.movimiento.findMany({
      where: { estado: 'ASIGNADO', fechaDevengamiento: { gte: desde, lt: hasta } },
      include: { categoria: true },
    }),
    ctx.db.movimiento.findMany({
      where: {
        estado: { in: ['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'VALIDADO'] },
        fechaDevengamiento: { gte: desde, lt: hasta },
      },
      select: { id: true, estado: true, fechaDevengamiento: true, descripcion: true },
    }),
  ]);

  const clave = (a: number, m: number) => `${a}-${m}`;
  const totalPorMes = new Map<string, number>();
  for (const mov of asignados) {
    if (!mov.fechaDevengamiento || !mov.categoria || mov.total == null) continue;
    const signo = signoMovimiento(mov.categoria.tipo, mov.tipoComprobante);
    const k = clave(mov.fechaDevengamiento.getUTCFullYear(), mov.fechaDevengamiento.getUTCMonth() + 1);
    totalPorMes.set(k, (totalPorMes.get(k) ?? 0) + signo * Math.round(Number(mov.total) * 100));
  }
  const pendPorMes = new Map<string, typeof pendientes>();
  for (const p of pendientes) {
    if (!p.fechaDevengamiento) continue;
    const k = clave(p.fechaDevengamiento.getUTCFullYear(), p.fechaDevengamiento.getUTCMonth() + 1);
    pendPorMes.set(k, [...(pendPorMes.get(k) ?? []), p]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">Períodos</h1>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`?ejercicio=${ejercicio - 1}`} className="btn-secondary text-xs">←</Link>
          <span className="px-2 font-medium">
            Ejercicio {ejercicio}/{ejercicio + 1} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {ejercicio + 1})
          </span>
          <Link href={`?ejercicio=${ejercicio + 1}`} className="btn-secondary text-xs">→</Link>
        </div>
      </div>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Estado</th>
              <th className="text-right">Resultado asignado</th>
              <th>Sin resolver</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {meses.map(({ anio, mes }) => {
              const k = clave(anio, mes);
              const periodo = periodos.find((p) => p.anio === anio && p.mes === mes);
              const cerrado = periodo?.estado === 'CERRADO';
              const total = totalPorMes.get(k) ?? 0;
              const pend = pendPorMes.get(k) ?? [];
              const porValidar = pend.filter((p) => p.estado === 'PENDIENTE_VALIDACION' || p.estado === 'OBSERVADO').length;
              const porAsignar = pend.filter((p) => p.estado === 'VALIDADO').length;
              const retenidos = pend.filter((p) => p.estado === 'RETENIDO').length;
              const bloqueantes = porValidar + porAsignar + retenidos;
              return (
                <tr key={k} className={cerrado ? 'bg-slate-50' : ''}>
                  <td className="font-medium whitespace-nowrap">{MES_LABEL[mes]} {anio}</td>
                  <td>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cerrado ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800'}`}>
                      {cerrado ? 'CERRADO' : 'ABIERTO'}
                    </span>
                  </td>
                  <td className={`num font-medium ${total < 0 ? 'text-red-700' : total > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {formatMoneyFirmado(total)}
                  </td>
                  <td className="text-sm space-x-2">
                    {porValidar > 0 && (
                      <Link href={`/${params.empresaSlug}/validacion`} className="text-amber-700 underline">
                        {porValidar} por validar
                      </Link>
                    )}
                    {porAsignar > 0 && (
                      <Link href={`/${params.empresaSlug}/asignacion`} className="text-amber-700 underline">
                        {porAsignar} por asignar
                      </Link>
                    )}
                    {retenidos > 0 && (
                      <span className="text-orange-700">{retenidos} retenido{retenidos !== 1 ? 's' : ''}</span>
                    )}
                    {bloqueantes === 0 && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {!cerrado ? (
                      <form action={cerrarPeriodoAction} className="inline">
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="ejercicio" value={String(ejercicio)} />
                        <input type="hidden" name="anio" value={anio} />
                        <input type="hidden" name="mes" value={mes} />
                        <button className="btn-secondary text-xs" title={bloqueantes > 0 ? 'Hay movimientos sin resolver: el cierre va a fallar y te los lista' : 'Congela el mes'}>
                          Cerrar mes
                        </button>
                      </form>
                    ) : esAdmin ? (
                      <form action={reabrirPeriodoAction} className="inline-flex items-center gap-1">
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="ejercicio" value={String(ejercicio)} />
                        <input type="hidden" name="anio" value={anio} />
                        <input type="hidden" name="mes" value={mes} />
                        <input name="motivo" required placeholder="Motivo (obligatorio)" className="input !w-44 text-xs" />
                        <button className="btn-danger text-xs">Reabrir</button>
                      </form>
                    ) : (
                      <span className="text-xs text-slate-400">Solo un administrador puede reabrir</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 max-w-2xl">
        Cerrar un mes lo congela: no se pueden crear, validar, editar ni anular movimientos con fecha en él. Los
        comprobantes que lleguen con fecha de un mes cerrado quedan <strong>retenidos</strong> hasta que un
        administrador reabra el período (acción auditada con motivo).
      </p>
    </div>
  );
}
