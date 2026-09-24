import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { EstadoBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { Icono } from '@/components/iconos';
import { formatMoney, formatMoneyFirmado, formatFecha } from '@/lib/format';
import { buildWhereVentas, resumirVentas, netoVentaCentavos, type FiltrosVentas } from '@/lib/ventas/query';
import { mapaCobranza } from '@/lib/cobranzas/query';
import { FUENTE_LABEL } from '@/lib/cobranzas/estado';
import { CobroBadge } from '@/components/cobro-badge';
import { FechaProbableInput } from '@/components/fecha-probable-input';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import type { Prisma } from '@prisma/client';

// Registro de ventas: tabla + tarjeta con el total de LO FILTRADO (la tarjeta
// sigue a los filtros, nunca a un mes fijo). Cobranzas (Spec F): estado de
// cobro derivado por venta, fecha probable editable, selección múltiple para
// registrar un cobro y filtro por estado de cobro.

const FILTROS_COBRO: Record<string, (i: { estado: string; vencida: boolean }) => boolean> = {
  pendientes: (i) => i.estado === 'PENDIENTE' || i.estado === 'PARCIAL',
  vencidas: (i) => (i.estado === 'PENDIENTE' || i.estado === 'PARCIAL') && i.vencida,
  cobradas: (i) => i.estado === 'COBRADA',
};
const MAX_FILAS = 300;
export default async function VentasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: FiltrosVentas & { cobro?: string; ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const cobranza = await mapaCobranza(ctx.db);
  const filtroCobro = FILTROS_COBRO[searchParams.cobro ?? ''];
  const whereBase = buildWhereVentas(searchParams, { esValidador, usuarioId: ctx.usuario.id });
  const where: Prisma.MovimientoWhereInput = filtroCobro
    ? { AND: [whereBase, { id: { in: [...cobranza].filter(([, i]) => filtroCobro(i)).map(([id]) => id) } }] }
    : whereBase;
  const hayFiltros = Boolean(
    searchParams.q?.trim() || searchParams.estado || searchParams.contraparteId || searchParams.desde || searchParams.hasta || filtroCobro,
  );

  const [ventas, clientes, paraResumen] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { contraparte: true, categoria: true, lineas: { include: { cliente: true } } },
      orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
      take: MAX_FILAS,
    }),
    ctx.db.contraparte.findMany({ where: { activa: true, tipo: { not: 'PROVEEDOR' } }, orderBy: { razonSocial: 'asc' } }),
    // El resumen cubre TODO lo filtrado, aunque la tabla corte en MAX_FILAS.
    ctx.db.movimiento.findMany({
      where,
      select: {
        id: true, estado: true, total: true, tipoComprobante: true, moneda: true, tipoCambio: true,
        iva21: true, iva105: true, iva27: true, percepcionesIva: true, percepcionesIibb: true, otrosTributos: true,
      },
    }),
  ]);

  const resumen = resumirVentas(paraResumen);
  // A cobrar de lo filtrado (saldo con IVA, pesificado al TC de cada factura).
  let aCobrar = 0;
  let vencido = 0;
  for (const v of paraResumen) {
    const i = cobranza.get(v.id);
    if (!i || i.saldoArs == null || (i.estado !== 'PENDIENTE' && i.estado !== 'PARCIAL')) continue;
    aCobrar += i.saldoArs;
    if (i.vencida) vencido += i.saldoArs;
  }
  const volverVentas = `ventas${searchParams.cobro ? `?cobro=${searchParams.cobro}` : ''}`;

  return (
    <div>
      <PageHeader
        titulo="Ventas"
        descripcion="Registro de comprobantes emitidos, con su categoría de ingreso y su asignación por unidad de negocio y cliente, y el estado de cobro de cada factura."
        acciones={
          <div className="flex flex-wrap gap-2">
            {esValidador && (
              <button form="form-cobro" className="btn-secondary" title="Tildá una o varias facturas de la tabla">
                Registrar cobro de las tildadas
              </button>
            )}
            <Link href={`/${params.empresaSlug}/asientos?tab=venta`} className="btn-success">
              <Icono nombre="venta" /> Registrar venta
            </Link>
          </div>
        }
      />
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />
      {/* Form del cobro: las casillas de la tabla lo referencian por id (no se anidan forms). */}
      <form id="form-cobro" method="get" action={`/${params.empresaSlug}/ventas/cobro`} />

      <div className="reveal reveal-2 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4 lg:col-span-2">
          <p className="label !mb-0.5">{hayFiltros ? 'Neto de lo filtrado' : 'Neto de ventas'} <span className="font-normal normal-case">(sin IVA)</span></p>
          <p className="font-mono text-2xl font-semibold tabular-nums text-accent-strong">
            {formatMoneyFirmado(resumen.netoCentavos)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">
            {resumen.cantidad} comprobante{resumen.cantidad !== 1 ? 's' : ''}
            {' · '}con IVA: <span className="tabular-nums">{formatMoneyFirmado(resumen.totalCentavos)}</span>
            {' · '}neto asignado: <span className="tabular-nums">{formatMoneyFirmado(resumen.asignadoCentavos)}</span> ({resumen.asignadas})
            {resumen.sinTipoCambio > 0 && (
              <span className="text-amber-700"> · {resumen.sinTipoCambio} en moneda extranjera sin TC, fuera del total</span>
            )}
          </p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">A cobrar <span className="font-normal normal-case">(con IVA)</span></p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(aCobrar)}</p>
          <p className="mt-1 text-[11px] text-ink-mute">
            vencido: <span className={`tabular-nums ${vencido > 0 ? 'text-red-700' : ''}`}>{formatMoney(vencido)}</span>
            {esValidador && (
              <>
                {' · '}
                <Link href={`/${params.empresaSlug}/cobranzas`} className="underline underline-offset-2 hover:text-tinta">ver proyección</Link>
              </>
            )}
          </p>
        </div>
        <div className="card p-4 flex items-center">
          <p className="text-[13px] text-ink-mute leading-relaxed">
            Solo lo <strong className="text-tinta">asignado</strong> impacta el resultado. Los cobros no tocan el P&L:
            sólo la diferencia de cambio de una factura en moneda extranjera.
          </p>
        </div>
      </div>

      <form method="get" className="reveal reveal-2 mb-3 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q ?? ''}
          className="input !w-auto min-w-[16rem] text-xs"
          placeholder="Buscar: cliente, descripción, número, CUIT…"
        />
        <input type="date" name="desde" defaultValue={searchParams.desde ?? ''} className="input !w-auto text-xs" title="Desde" />
        <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ''} className="input !w-auto text-xs" title="Hasta" />
        <select name="estado" defaultValue={searchParams.estado ?? ''} className="input !w-auto text-xs">
          <option value="">Todos los estados</option>
          <option value="PENDIENTE_VALIDACION">Pendientes</option>
          <option value="VALIDADO">Validadas</option>
          <option value="ASIGNADO">Asignadas</option>
          <option value="ANULADO">Anuladas</option>
        </select>
        <select name="cobro" defaultValue={searchParams.cobro ?? ''} className="input !w-auto text-xs">
          <option value="">Cualquier cobro</option>
          <option value="pendientes">Por cobrar</option>
          <option value="vencidas">Vencidas</option>
          <option value="cobradas">Cobradas</option>
        </select>
        <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto text-xs">
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.razonSocial}</option>
          ))}
        </select>
        <button className="btn-secondary text-xs">Filtrar</button>
        {hayFiltros && (
          <Link href={`/${params.empresaSlug}/ventas`} className="text-xs underline underline-offset-2 text-ink-mute hover:text-tinta">
            Limpiar
          </Link>
        )}
      </form>

      <div className="reveal reveal-3 card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {esValidador && <th className="w-6"></th>}
              <th>Fecha</th>
              <th>Descripción / cliente</th>
              <th>Comprobante</th>
              <th>Categoría · asignación</th>
              <th>Estado</th>
              <th>Cobro · fecha probable</th>
              <th className="text-right">Neto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} className={v.estado === 'ANULADO' ? 'opacity-50' : ''}>
                {esValidador && (
                  <td>
                    {(() => {
                      const i = cobranza.get(v.id);
                      return i && (i.estado === 'PENDIENTE' || i.estado === 'PARCIAL') ? (
                        <input type="checkbox" name="ids" value={v.id} form="form-cobro" aria-label="Incluir en el cobro" className="accent-accent" />
                      ) : null;
                    })()}
                  </td>
                )}
                <td className="whitespace-nowrap font-mono text-[12.5px]">{formatFecha(v.fechaDevengamiento)}</td>
                <td>
                  <span className="font-medium">{v.contraparte?.razonSocial ?? v.descripcion ?? '—'}</span>
                  {v.contraparte && v.descripcion && <span className="text-ink-mute"> — {v.descripcion}</span>}
                </td>
                <td className="whitespace-nowrap font-mono text-[12.5px]">
                  {v.tipoComprobante?.replace(/_/g, ' ') ?? '—'} {v.puntoVenta ? `${v.puntoVenta}-` : ''}{v.numero ?? ''}
                </td>
                <td className="text-ink-mute">
                  {v.categoria?.nombre ?? '—'}
                  <span className="block text-[11px]">
                  {v.lineas.map((l, i) => (
                    <span key={l.id}>
                      {i > 0 && ' · '}
                      {l.cliente?.nombre ?? 'sin cliente'} {Number(l.porcentaje).toLocaleString('es-AR')}%
                    </span>
                  ))}
                  </span>
                </td>
                <td><EstadoBadge estado={v.estado} /></td>
                {(() => {
                  const i = cobranza.get(v.id);
                  if (!i) return <td className="text-ink-mute">—</td>;
                  const moneda = v.moneda === 'ARS' ? '' : ` ${v.moneda}`;
                  return (
                    <td className="whitespace-nowrap">
                        <CobroBadge estado={i.estado} vencida={i.vencida} diasVencida={i.diasVencida} />
                        {i.estado === 'PARCIAL' && (
                          <span className="block text-[10px] text-ink-mute tabular-nums">saldo {formatMoney(i.saldo)}{moneda}</span>
                        )}
                        {i.fechaProbable && i.estado !== 'COBRADA' && i.estado !== 'NO_APLICA' && (
                          <FechaProbableInput
                            slug={params.empresaSlug}
                            ventaId={v.id}
                            fechaIso={i.fechaProbable.fecha.toISOString().slice(0, 10)}
                            fuente={FUENTE_LABEL[i.fechaProbable.fuente]}
                            manual={i.fechaProbable.fuente === 'MANUAL'}
                            editable={esValidador}
                          />
                        )}
                    </td>
                  );
                })()}
                <td className="num font-medium text-accent-strong">
                  {(() => {
                    const neto = netoVentaCentavos(v);
                    return neto != null ? formatMoneyFirmado(neto) : formatMoney(v.total ? Number(v.total) : null);
                  })()}
                  {v.total != null && (
                    <span className="block text-[10px] font-normal text-ink-mute">
                      con IVA {formatMoney(Number(v.total))}
                      {v.moneda !== 'ARS' && ` ${v.moneda}${v.tipoCambio != null ? ` · TC ${Number(v.tipoCambio).toLocaleString('es-AR')}` : ' · sin TC'}`}
                    </span>
                  )}
                </td>
                <td className="text-right whitespace-nowrap">
                  {esValidador && (
                    <>
                      <Link href={`/${params.empresaSlug}/validacion/${v.id}`} className="text-[12.5px] underline underline-offset-2 text-accent-strong hover:text-accent">
                        {v.estado === 'PENDIENTE_VALIDACION' ? 'Validar' : 'Ver'}
                      </Link>
                      {cobranza.get(v.id)?.estado !== 'NO_APLICA' && (
                        <Link href={`/${params.empresaSlug}/ventas/${v.id}/cobros?volver=${encodeURIComponent(volverVentas)}`} className="mt-1 block text-[12.5px] underline underline-offset-2 text-ink-mute hover:text-tinta">
                          Cobros
                        </Link>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {ventas.length === 0 && (
              <tr>
                <td colSpan={esValidador ? 9 : 8} className="py-12 text-center text-ink-mute">
                  {hayFiltros ? (
                    <>Ninguna venta coincide con el filtro.</>
                  ) : (
                    <>
                      Sin ventas registradas todavía.{' '}
                      <Link href={`/${params.empresaSlug}/asientos?tab=venta`} className="underline text-accent-strong">
                        Registrá la primera
                      </Link>.
                    </>
                  )}
                </td>
              </tr>
            )}
            {resumen.cantidad > ventas.length && (
              <tr>
                <td colSpan={esValidador ? 9 : 8} className="py-3 text-center text-[12px] text-ink-mute">
                  Se muestran las {ventas.length} más recientes de {resumen.cantidad}; el neto de arriba las incluye a todas. Afiná el filtro para ver el resto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
