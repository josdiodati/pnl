import Link from 'next/link';
import { requireReportePage } from '@/lib/reportes-personalizados/acceso';
import { reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { agruparGastoPorProveedor } from '@/lib/reportes-personalizados/gasto-por-proveedor';
import { buildWhereComprobantes } from '@/lib/comprobantes/query';
import { PageHeader } from '@/components/page-header';
import { formatMoney, formatFecha } from '@/lib/format';

// Reporte personalizado: los proveedores con más compras netas de los últimos
// 12 meses. Cada número lleva a Comprobantes filtrado por proveedor y período.

const ID = 'gasto-por-proveedor';
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const pct = (x: number) => `${(x * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;

export default async function GastoPorProveedorPage({ params }: { params: { empresaSlug: string } }) {
  const ctx = await requireReportePage(params.empresaSlug, ID);
  const reporte = reporteDelCatalogo(ID)!;
  const hoy = new Date();
  const hasta = isoDia(hoy);
  const desde = isoDia(new Date(Date.UTC(hoy.getUTCFullYear() - 1, hoy.getUTCMonth(), hoy.getUTCDate() + 1)));

  const compras = await ctx.db.movimiento.findMany({
    where: buildWhereComprobantes({ lado: 'compras', desde, hasta }, { esValidador: true, usuarioId: ctx.usuario.id }),
    select: {
      contraparteId: true, moneda: true, tipoCambio: true, tipoComprobante: true, total: true,
      iva21: true, iva105: true, iva27: true, percepcionesIva: true, percepcionesIibb: true, otrosTributos: true,
      contraparte: { select: { razonSocial: true } },
    },
  });
  const r = agruparGastoPorProveedor(compras.map((c) => ({ ...c, proveedor: c.contraparte?.razonSocial ?? '' })));

  const drill = (contraparteId?: string) => {
    const sp = new URLSearchParams({ desde, hasta });
    if (contraparteId) sp.set('contraparteId', contraparteId);
    return `/${params.empresaSlug}/comprobantes?${sp}`;
  };
  const max = Math.max(...r.filas.map((f) => f.netoArs), 1);

  return (
    <div>
      <PageHeader
        titulo={reporte.titulo}
        descripcion={`${reporte.descripcion} Período: ${formatFecha(desde)} a ${formatFecha(hasta)}.`}
        acciones={<Link href={`/${params.empresaSlug}/reportes-personalizados`} className="btn-secondary">Reportes personalizados</Link>}
      />
      {r.sinTipoCambio > 0 && (
        <p className="mb-3 text-[12px] text-amber-700">
          {r.sinTipoCambio} comprobante{r.sinTipoCambio > 1 ? 's' : ''} en moneda extranjera sin tipo de cambio quedan fuera de los totales.
        </p>
      )}
      <section className="reveal reveal-2 card overflow-x-auto p-4">
        {r.filas.length === 0 ? (
          <p className="text-sm text-ink-mute">No hay comprobantes de compra en el período.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th className="text-right">Comprobantes</th>
                <th className="text-right">Neto</th>
                <th className="w-48">% del total</th>
              </tr>
            </thead>
            <tbody>
              {r.filas.map((f) => (
                <tr key={f.contraparteId ?? 'sin'}>
                  <td className="font-medium">{f.proveedor}</td>
                  <td className="text-right tabular-nums">
                    {f.contraparteId ? <Link href={drill(f.contraparteId)} className="underline-offset-2 hover:underline">{f.cantidad}</Link> : f.cantidad}
                  </td>
                  <td className="text-right font-mono tabular-nums">
                    {f.contraparteId ? <Link href={drill(f.contraparteId)} className="underline-offset-2 hover:underline">{formatMoney(f.netoArs)}</Link> : formatMoney(f.netoArs)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-sm bg-line">
                        <div className="h-2 rounded-sm bg-ink" style={{ width: `${Math.max(0, (f.netoArs / max) * 100)}%` }} />
                      </div>
                      <span className="w-14 text-right text-[12px] tabular-nums text-ink-mute">{pct(f.pct)}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {r.resto && (
                <tr className="text-ink-mute">
                  <td>Resto ({r.resto.proveedores} proveedor{r.resto.proveedores > 1 ? 'es' : ''})</td>
                  <td className="text-right tabular-nums">{r.resto.cantidad}</td>
                  <td className="text-right font-mono tabular-nums">{formatMoney(r.resto.netoArs)}</td>
                  <td className="text-right text-[12px] tabular-nums">{pct(r.total.netoArs ? r.resto.netoArs / r.total.netoArs : 0)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right tabular-nums"><Link href={drill()} className="underline-offset-2 hover:underline">{r.total.cantidad}</Link></td>
                <td className="text-right font-mono tabular-nums"><Link href={drill()} className="underline-offset-2 hover:underline">{formatMoney(r.total.netoArs)}</Link></td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </div>
  );
}
