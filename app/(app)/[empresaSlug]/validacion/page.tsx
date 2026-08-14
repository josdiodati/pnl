import Link from 'next/link';
import type { EstadoMovimiento, Prisma } from '@prisma/client';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { EstadoBadge, ArcaBadge, CanalBadge, QrBadge } from '@/components/badges';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { formatMoney, formatFecha } from '@/lib/format';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';

// Validation queue: filterable list with counters, ordered "most doubtful
// first" (lowest extraction confidence, then oldest).

const ESTADOS_COLA: EstadoMovimiento[] = ['PENDIENTE_VALIDACION', 'RETENIDO', 'OBSERVADO', 'DUPLICADO', 'ERROR_PROCESAMIENTO'];

export default async function ValidacionPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { estado?: string; canal?: string; contraparteId?: string; error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');

  const estadoFiltro = (ESTADOS_COLA as string[]).includes(searchParams.estado ?? '')
    ? (searchParams.estado as EstadoMovimiento)
    : 'PENDIENTE_VALIDACION';

  const where: Prisma.MovimientoWhereInput = {
    estado: estadoFiltro,
    ...(searchParams.canal ? { canalIngreso: searchParams.canal } : {}),
    ...(searchParams.contraparteId ? { contraparteId: searchParams.contraparteId } : {}),
  };

  const [conteos, movimientos, contrapartes] = await Promise.all([
    ctx.db.movimiento.groupBy({ by: ['estado'], where: { estado: { in: ESTADOS_COLA } }, _count: { _all: true } }),
    ctx.db.movimiento.findMany({
      where,
      include: { contraparte: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
  ]);
  const conteo = Object.fromEntries(conteos.map((c) => [c.estado, c._count._all]));

  // "most doubtful first": min confidence reported by the extractor
  const conConfianza = movimientos.map((m) => {
    const conf = (m.confianza as Record<string, number> | null) ?? {};
    const valores = Object.values(conf);
    return { m, confMin: valores.length ? Math.min(...valores) : 1 };
  });
  conConfianza.sort((a, b) => a.confMin - b.confMin || a.m.createdAt.getTime() - b.m.createdAt.getTime());

  const tabs: { estado: EstadoMovimiento; label: string }[] = [
    { estado: 'PENDIENTE_VALIDACION', label: 'Pendientes' },
    { estado: 'RETENIDO', label: 'Retenidos' },
    { estado: 'OBSERVADO', label: 'Observados' },
    { estado: 'DUPLICADO', label: 'Duplicados' },
    { estado: 'ERROR_PROCESAMIENTO', label: 'Errores' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Cola de validación</h1>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link
            key={t.estado}
            href={`?estado=${t.estado}`}
            className={`rounded-full px-3 py-1 text-sm border ${
              estadoFiltro === t.estado ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-600'
            }`}
          >
            {t.label} <span className="tabular-nums">({conteo[t.estado] ?? 0})</span>
          </Link>
        ))}
        <form className="ml-auto flex gap-2" method="get">
          <input type="hidden" name="estado" value={estadoFiltro} />
          <select name="canal" defaultValue={searchParams.canal ?? ''} className="input !w-auto text-xs">
            <option value="">Todos los canales</option>
            <option value="WEB">Web</option>
            <option value="FOTO">Foto</option>
            <option value="EMAIL">Email</option>
            <option value="TELEGRAM">Telegram</option>
            <option value="MANUAL">Manual</option>
          </select>
          <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto text-xs max-w-[200px]">
            <option value="">Todas las contrapartes</option>
            {contrapartes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
          <button className="btn-secondary text-xs">Filtrar</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Ingresado</th>
              <th>Contraparte / emisor</th>
              <th>Comprobante</th>
              <th>Fecha</th>
              <th className="text-right">Total</th>
              <th>Alertas</th>
              <th>Canal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {conConfianza.map(({ m, confMin }) => {
              const revisar = Object.keys((m.camposRevisar as object | null) ?? {}).length;
              const duplicados = ((m.flags as { duplicados?: string[] } | null)?.duplicados ?? []).length;
              const reglaPre = (m.flags as { reglaPreasignacion?: string } | null)?.reglaPreasignacion;
              const cp = nombreContraparte(m);
              return (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap text-slate-500">{formatFecha(m.createdAt)}</td>
                  <td className="font-medium">
                    {cp.nombre ?? <span className="text-slate-400">Sin identificar</span>}
                    {cp.esNueva && (
                      <span className="ml-1 text-xs rounded bg-blue-50 text-blue-700 px-1">nueva</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-slate-600">
                    {m.tipoComprobante?.replace(/_/g, ' ') ?? '—'} {m.puntoVenta ? `${m.puntoVenta}-` : ''}{m.numero ?? ''}
                  </td>
                  <td className="whitespace-nowrap">{formatFecha(m.fechaDevengamiento)}</td>
                  <td className="num">{formatMoney(m.total ? Number(m.total) : null)}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    <EstadoBadge estado={m.estado} />
                    {m.cae && <ArcaBadge estado={m.arcaEstado} />}
                    <QrBadge estado={m.qrEstado} />
                    {duplicados > 0 && (
                      <span className="inline-block rounded bg-red-100 text-red-800 px-1.5 py-0.5 text-xs font-medium">⚠ posible duplicado</span>
                    )}
                    {revisar > 0 && (
                      <span className="inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-xs">
                        {revisar} campo{revisar !== 1 ? 's' : ''} a revisar
                      </span>
                    )}
                    {confMin < 0.7 && (
                      <span className="inline-block rounded bg-amber-50 text-amber-700 px-1.5 py-0.5 text-xs">confianza baja</span>
                    )}
                    {reglaPre && (
                      <span
                        title={`Pre-asignado por la regla «${reglaPre}». La imputación ya viene cargada.`}
                        className="cursor-help inline-block rounded bg-sky-100 text-sky-800 px-1.5 py-0.5 text-xs font-medium"
                      >
                        ⚡ regla
                      </span>
                    )}
                  </td>
                  <td><CanalBadge canal={m.canalIngreso} /></td>
                  <td className="text-right">
                    <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="btn-primary text-xs">
                      Revisar
                    </Link>
                  </td>
                </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  Nada para revisar en este estado. 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
