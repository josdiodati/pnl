import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { HistorialCobro } from '@/components/historial-cobro';
import { formatMoney, formatFecha, formatFechaHora } from '@/lib/format';
import { netoDe } from '@/lib/movimientos/neto';
import { INSTRUMENTO_LABEL, ESTADO_COBRO_LABEL, ES_CHEQUE } from '@/lib/cobranzas/labels';
import { etiquetaVenta, motivoSoloDatos } from '@/lib/cobranzas/service';
import { eliminarCobroAction, acreditarChequeAction, rechazarChequeAction } from '../../../ventas/actions';

// Detalle de un cobro (el grupo: uno o varios instrumentos cargados juntos):
// instrumentos con n° y banco, facturas que paga, acciones e historial.

export default async function CobroPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; grupo: string };
  searchParams: { ok?: string; error?: string; volver?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const cobros = await ctx.db.cobro.findMany({
    where: { grupo: params.grupo },
    include: {
      contraparte: true,
      resumenLinea: { include: { resumen: true } },
      aplicaciones: { include: { movimiento: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (cobros.length === 0) notFound();

  const volver = searchParams.volver || 'cobranzas';
  const aqui = `cobranzas/cobros/${params.grupo}?volver=${encodeURIComponent(volver)}`;
  const base = `/${params.empresaSlug}`;
  const primero = cobros[0];
  const soloDatos = motivoSoloDatos(cobros);
  const eliminable = cobros.every((c) => c.origen === 'MANUAL' && !c.resumenLineaId);

  // Facturas: una fila por venta con lo aplicado por todos los instrumentos.
  const porVenta = new Map<string, { mov: (typeof cobros)[number]['aplicaciones'][number]['movimiento']; importe: number; ajusteId: string | null }>();
  for (const a of cobros.flatMap((c) => c.aplicaciones)) {
    const x = porVenta.get(a.movimientoId) ?? { mov: a.movimiento, importe: 0, ajusteId: null };
    x.importe += Number(a.importe);
    x.ajusteId = x.ajusteId ?? a.ajusteId;
    porVenta.set(a.movimientoId, x);
  }
  const ajusteIds = [...porVenta.values()].map((v) => v.ajusteId).filter((x): x is string => Boolean(x));
  const [ajustes, creador, ultimaEdicion] = await Promise.all([
    ajusteIds.length ? ctx.db.movimiento.findMany({ where: { id: { in: ajusteIds } } }) : Promise.resolve([]),
    prisma.usuario.findUnique({ where: { id: primero.creadoPorId }, select: { nombre: true } }),
    ctx.db.auditLog.findFirst({ where: { entidad: 'Cobro', entidadId: params.grupo, accion: 'COBRO_EDITAR' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const editor = ultimaEdicion?.usuarioId
    ? await prisma.usuario.findUnique({ where: { id: ultimaEdicion.usuarioId }, select: { nombre: true } })
    : null;
  const ajustePorId = new Map(ajustes.map((m) => [m.id, m]));
  const ventas = new Map([...porVenta.entries()].map(([id, v]) => [id, etiquetaVenta(v.mov)]));
  const total = cobros.reduce((s, c) => s + (c.moneda === primero.moneda ? Number(c.monto) : 0), 0);
  const monedaTxt = (m: string) => (m === 'ARS' ? '' : ` ${m}`);

  return (
    <div>
      <PageHeader
        titulo={`Cobro · ${primero.contraparte?.razonSocial ?? 'varios clientes'}`}
        descripcion={
          `${primero.origen === 'RESUMEN' ? 'Creado al conciliar el resumen' : `Cargado por ${creador?.nombre ?? '—'}`} el ${formatFechaHora(primero.createdAt)}` +
          (ultimaEdicion ? ` · última edición: ${editor?.nombre ?? 'Sistema'}, ${formatFechaHora(ultimaEdicion.createdAt)}` : '')
        }
        acciones={
          <div className="flex gap-2">
            <Link href={`${base}/cobranzas/cobros/${params.grupo}/editar?volver=${encodeURIComponent(volver)}`} className="btn-primary">Editar</Link>
            {eliminable && (
              <form action={eliminarCobroAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="grupo" value={params.grupo} />
                <input type="hidden" name="volver" value={volver} />
                <button className="btn-secondary hover:text-red-700" title="Elimina el cobro completo (todos sus instrumentos)">Eliminar</button>
              </form>
            )}
            <Link href={`${base}/${volver}`} className="btn-secondary">Volver</Link>
          </div>
        }
      />
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="label !mb-0.5">Total del cobro</p>
          <p className="font-mono text-xl tabular-nums">{formatMoney(total)}{monedaTxt(primero.moneda)}</p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">Recibido</p>
          <p className="font-mono text-xl tabular-nums">{formatFecha(primero.fecha)}</p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">Nota</p>
          <p className="text-[13px]">{primero.nota || <span className="text-ink-mute">—</span>}</p>
        </div>
      </div>
      {soloDatos && <p className="mb-3 text-[12px] text-ink-mute">{soloDatos}</p>}

      <section className="card overflow-x-auto mb-4">
        <h2 className="px-4 pt-4 font-display text-lg">Instrumentos</h2>
        <table className="table-base mt-2">
          <thead>
            <tr>
              <th>Recibido</th><th>Instrumento</th><th>N°</th><th>Banco</th><th>Estado</th><th>Acreditación</th>
              <th className="text-right">Monto</th><th>Resumen bancario</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cobros.map((c) => (
              <tr key={c.id} className={c.estado === 'RECHAZADO' ? 'opacity-50' : ''}>
                <td className="font-mono text-[12.5px]">{formatFecha(c.fecha)}</td>
                <td>{INSTRUMENTO_LABEL[c.instrumento]}</td>
                <td className="font-mono text-[12.5px]">{c.numero ?? '—'}</td>
                <td>{c.banco ?? <span className="text-ink-mute">—</span>}</td>
                <td className="text-[12px]">{ESTADO_COBRO_LABEL[c.estado]}</td>
                <td className="font-mono text-[12.5px]">{formatFecha(c.fechaAcreditacion)}</td>
                <td className="num">{formatMoney(Number(c.monto))}{monedaTxt(c.moneda)}</td>
                <td className="text-[12px] text-ink-mute">
                  {c.resumenLinea ? (
                    <Link href={`${base}/resumenes/${c.resumenLinea.resumenId}?linea=${c.resumenLinea.id}`} className="underline underline-offset-2">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto mb-4">
        <h2 className="px-4 pt-4 font-display text-lg">Facturas que paga</h2>
        <table className="table-base mt-2">
          <thead><tr><th>Factura</th><th>Emitida</th><th className="text-right" title="Sin IVA, percepciones ni otros tributos">Neto</th><th className="text-right">Total</th><th className="text-right">Aplicado</th><th>Ajuste de cambio</th></tr></thead>
          <tbody>
            {[...porVenta.entries()].map(([id, v]) => {
              const ajuste = v.ajusteId ? ajustePorId.get(v.ajusteId) : null;
              return (
                <tr key={id}>
                  <td className="font-mono text-[12.5px] whitespace-nowrap">
                    <Link href={`${base}/ventas/${id}/cobros?volver=${encodeURIComponent(volver)}`} className="underline underline-offset-2">{etiquetaVenta(v.mov)}</Link>
                  </td>
                  <td className="font-mono text-[12.5px]">{formatFecha(v.mov.fechaDevengamiento)}</td>
                  <td className="num text-ink-mute">{formatMoney(netoDe(v.mov))}{monedaTxt(v.mov.moneda)}</td>
                  <td className="num text-ink-mute">{formatMoney(v.mov.total != null ? Number(v.mov.total) : null)}{monedaTxt(v.mov.moneda)}</td>
                  <td className="num">{formatMoney(Math.round(v.importe * 100) / 100)}{monedaTxt(v.mov.moneda)}</td>
                  <td className="text-[12px] text-ink-mute">
                    {ajuste ? `${formatMoney(Number(ajuste.total))}${ajuste.estado === 'ANULADO' ? ' (anulado)' : ''}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <HistorialCobro db={ctx.db} empresaId={ctx.empresa.id} grupo={params.grupo} alta={primero} ventas={ventas} />
    </div>
  );
}
