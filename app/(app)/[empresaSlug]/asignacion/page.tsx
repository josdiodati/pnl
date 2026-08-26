import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { formatMoney, formatFecha } from '@/lib/format';
import { nombreContraparte, esVenta } from '@/lib/movimientos/nombre-contraparte';

export default async function AsignacionPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');

  const movimientos = await ctx.db.movimiento.findMany({
    where: { estado: 'VALIDADO' },
    include: { contraparte: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Cola de Asignación</h1>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Contraparte</th>
              <th>Tipo</th>
              <th>Comprobante</th>
              <th>Fecha</th>
              <th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              const cp = nombreContraparte(m);
              return (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="font-medium">
                  {cp.nombre ?? <span className="text-slate-400">Sin identificar</span>}
                  {cp.esNueva && (
                    <span className="ml-1 text-xs rounded bg-blue-50 text-blue-700 px-1">nueva</span>
                  )}
                </td>
                <td>
                  {esVenta(m.origen) ? (
                    <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-xs font-medium">Venta</span>
                  ) : (
                    <span className="inline-block rounded bg-red-50 text-red-700 px-1.5 py-0.5 text-xs font-medium">Gasto</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-slate-600">
                  {m.tipoComprobante?.replace(/_/g, ' ') ?? '—'} {m.puntoVenta ? `${m.puntoVenta}-` : ''}{m.numero ?? ''}
                </td>
                <td className="whitespace-nowrap">{formatFecha(m.fechaDevengamiento)}</td>
                <td className="num">{formatMoney(m.total ? Number(m.total) : null)}</td>
                <td className="text-right">
                  <Link href={`/${params.empresaSlug}/asignacion/${m.id}`} className="btn-primary text-xs">
                    Asignar
                  </Link>
                </td>
              </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-8">
                  No hay comprobantes validados pendientes de asignación.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
