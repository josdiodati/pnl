import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { formatMoney, formatFecha } from '@/lib/format';

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
              <th>Comprobante</th>
              <th>Fecha</th>
              <th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="font-medium">
                  {m.contraparte?.razonSocial ?? <span className="text-slate-400">Sin contraparte</span>}
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
            ))}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-8">
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
