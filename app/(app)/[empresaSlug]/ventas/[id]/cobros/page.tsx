import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { CobroBadge } from '@/components/cobro-badge';
import { FechaProbableInput } from '@/components/fecha-probable-input';
import { formatMoney, formatFecha } from '@/lib/format';
import { mapaCobranza } from '@/lib/cobranzas/query';
import { FUENTE_LABEL } from '@/lib/cobranzas/estado';
import { INSTRUMENTO_LABEL, ESTADO_COBRO_LABEL, ES_CHEQUE } from '@/lib/cobranzas/labels';
import { eliminarCobroAction, cerrarRetencionAction, acreditarChequeAction, rechazarChequeAction } from '../../actions';

// Cobranza de una factura: saldo, fecha probable, cobros aplicados (con su
// origen: registrado a mano o creado por el resumen) y acciones.

export default async function CobrosVentaPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { ok?: string; error?: string; volver?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const venta = await ctx.db.movimiento.findFirst({
    where: { id: params.id, origen: { in: ['VENTA_MANUAL', 'VENTA_COMPROBANTE'] } },
    include: {
      contraparte: true,
      aplicacionesCobro: {
        include: { cobro: { include: { resumenLinea: { include: { resumen: true } }, aplicaciones: { include: { movimiento: true } } } } },
        orderBy: { cobro: { fecha: 'asc' } },
      },
    },
  });
  if (!venta) notFound();
  const info = (await mapaCobranza(ctx.db)).get(venta.id);
  const aqui = `ventas/${venta.id}/cobros`;
  const volverTabla = searchParams.volver || 'ventas';
  const ajustes = venta.aplicacionesCobro.map((a) => a.ajusteId).filter((x): x is string => Boolean(x));
  const movAjustes = ajustes.length ? await ctx.db.movimiento.findMany({ where: { id: { in: ajustes } } }) : [];
  const ajustePorId = new Map(movAjustes.map((m) => [m.id, m]));
  const etiqueta = `${venta.tipoComprobante?.replace(/_/g, ' ') ?? 'Venta'} ${venta.puntoVenta ? `${venta.puntoVenta}-` : ''}${venta.numero ?? ''}`.trim();
  const m = venta.moneda === 'ARS' ? '' : ` ${venta.moneda}`;
  const cobrable = info && info.estado !== 'NO_APLICA';

  return (
    <div>
      <PageHeader
        titulo={`Cobranza · ${etiqueta}`}
        descripcion={`${venta.contraparte?.razonSocial ?? venta.descripcion ?? ''} · emitida el ${formatFecha(venta.fechaDevengamiento)}`}
        acciones={
          <div className="flex gap-2">
            {cobrable && info!.saldo > 0 && (
              <Link href={`/${params.empresaSlug}/ventas/cobro?ids=${venta.id}&volver=${encodeURIComponent(aqui)}`} className="btn-primary">Registrar cobro</Link>
            )}
            <Link href={`/${params.empresaSlug}/${volverTabla}`} className="btn-secondary">Volver</Link>
          </div>
        }
      />
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="label !mb-0.5">Total</p>
          <p className="font-mono text-xl tabular-nums">{formatMoney(venta.total ? Number(venta.total) : null)}{m}</p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">Cobrado</p>
          <p className="font-mono text-xl tabular-nums">{formatMoney(info?.cobrado ?? 0)}{m}</p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">Saldo</p>
          <p className="font-mono text-xl tabular-nums">{formatMoney(info?.saldo ?? 0)}{m}</p>
          {info && <div className="mt-1"><CobroBadge estado={info.estado} vencida={info.vencida} diasVencida={info.diasVencida} /></div>}
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">Fecha probable de cobro</p>
          {info?.fechaProbable && info.estado !== 'COBRADA' ? (
            <FechaProbableInput
              slug={params.empresaSlug}
              ventaId={venta.id}
              fechaIso={info.fechaProbable.fecha.toISOString().slice(0, 10)}
              fuente={FUENTE_LABEL[info.fechaProbable.fuente]}
              manual={info.fechaProbable.fuente === 'MANUAL'}
              editable
            />
          ) : (
            <p className="text-ink-mute">—</p>
          )}
          {venta.fechaVencimientoPago && (
            <p className="mt-1 text-[11px] text-ink-mute">Vencimiento impreso: {formatFecha(venta.fechaVencimientoPago)}</p>
          )}
        </div>
      </div>

      {cobrable && venta.moneda === 'ARS' && info!.estado === 'PARCIAL' && (
        <form action={cerrarRetencionAction} className="mb-4 flex items-center gap-3 card p-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="ventaId" value={venta.id} />
          <input type="hidden" name="volver" value={aqui} />
          <p className="text-[13px] text-ink-mute">¿El saldo de {formatMoney(info!.saldo)} es una retención que sufrió el cobro?</p>
          <button className="btn-secondary text-xs">Cerrar saldo como retención</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Recibido</th><th>Instrumento</th><th>Estado</th><th>Acreditación</th><th className="text-right">Monto</th>
              <th className="text-right">Aplicado a esta factura</th><th>Banco</th><th></th>
            </tr>
          </thead>
          <tbody>
            {venta.aplicacionesCobro.map((a) => {
              const c = a.cobro;
              const otras = c.aplicaciones.filter((x) => x.movimientoId !== venta.id);
              const ajuste = a.ajusteId ? ajustePorId.get(a.ajusteId) : null;
              return (
                <tr key={a.id} className={c.estado === 'RECHAZADO' ? 'opacity-50' : ''}>
                  <td className="font-mono text-[12.5px]">{formatFecha(c.fecha)}</td>
                  <td>
                    {INSTRUMENTO_LABEL[c.instrumento]}{c.numero ? ` ${c.numero}` : ''}{c.banco ? ` · ${c.banco}` : ''}
                    {c.origen === 'RESUMEN' && <span className="ml-1 text-[10px] text-ink-mute">(creado por el resumen)</span>}
                    {otras.length > 0 && <span className="block text-[10px] text-ink-mute">también paga {otras.length} factura{otras.length > 1 ? 's' : ''} más</span>}
                    {ajuste && (
                      <span className="block text-[10px] text-ink-mute">
                        ajuste de cambio {formatMoney(Number(ajuste.total))}{ajuste.estado === 'ANULADO' ? ' (anulado)' : ''}
                      </span>
                    )}
                  </td>
                  <td className="text-[12px]">{ESTADO_COBRO_LABEL[c.estado]}</td>
                  <td className="font-mono text-[12.5px]">{formatFecha(c.fechaAcreditacion)}</td>
                  <td className="num">{formatMoney(Number(c.monto))}{c.moneda === 'ARS' ? '' : ` ${c.moneda}`}</td>
                  <td className="num">{formatMoney(Number(a.importe))}{m}</td>
                  <td className="text-[12px] text-ink-mute">
                    {c.resumenLinea ? (
                      <Link href={`/${params.empresaSlug}/resumenes/${c.resumenLinea.resumenId}?linea=${c.resumenLinea.id}`} className="underline underline-offset-2">
                        confirmado ({c.resumenLinea.resumen.emisor})
                      </Link>
                    ) : c.instrumento === 'RETENCION' || c.instrumento === 'NOTA_CREDITO' ? 'no aplica' : 'sin confirmar'}
                  </td>
                  <td className="text-right whitespace-nowrap space-x-2">
                    {ES_CHEQUE.has(c.instrumento) && c.estado === 'EN_CARTERA' && (
                      <>
                        <form action={acreditarChequeAction} className="inline">
                          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                          <input type="hidden" name="cobroId" value={c.id} />
                          <input type="hidden" name="volver" value={aqui} />
                          <button className="text-[12px] underline underline-offset-2 text-accent-strong">Acreditado</button>
                        </form>
                        <form action={rechazarChequeAction} className="inline">
                          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                          <input type="hidden" name="cobroId" value={c.id} />
                          <input type="hidden" name="volver" value={aqui} />
                          <button className="text-[12px] underline underline-offset-2 text-red-700">Rechazado</button>
                        </form>
                      </>
                    )}
                    {c.origen === 'MANUAL' && !c.resumenLineaId && (
                      <form action={eliminarCobroAction} className="inline">
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="grupo" value={c.grupo} />
                        <input type="hidden" name="volver" value={aqui} />
                        <button className="text-[12px] underline underline-offset-2 text-ink-mute hover:text-red-700" title="Elimina el cobro completo (todos sus instrumentos)">
                          Eliminar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {venta.aplicacionesCobro.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-ink-mute">Sin cobros registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
