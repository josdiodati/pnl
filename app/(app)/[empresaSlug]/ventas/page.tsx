import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { EstadoBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { Icono } from '@/components/iconos';
import { formatMoney, formatMoneyFirmado, formatFecha } from '@/lib/format';
import { buildWhereVentas, resumirVentas, type FiltrosVentas } from '@/lib/ventas/query';

// Registro de ventas: tabla + tarjeta con el total de LO FILTRADO (la tarjeta
// sigue a los filtros, nunca a un mes fijo). La lectura automática desde ARCA
// es de la próxima etapa.
const MAX_FILAS = 300;
export default async function VentasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: FiltrosVentas;
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const where = buildWhereVentas(searchParams, { esValidador, usuarioId: ctx.usuario.id });
  const hayFiltros = Boolean(
    searchParams.q?.trim() || searchParams.estado || searchParams.contraparteId || searchParams.desde || searchParams.hasta,
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
      select: { estado: true, total: true, tipoComprobante: true, moneda: true, tipoCambio: true },
    }),
  ]);

  const resumen = resumirVentas(paraResumen);

  return (
    <div>
      <PageHeader
        titulo="Ventas"
        descripcion="Registro de comprobantes emitidos, con su categoría de ingreso y su asignación por unidad de negocio y cliente. La lectura automática desde ARCA llega en la próxima etapa."
        acciones={
          <Link href={`/${params.empresaSlug}/asientos?tab=venta`} className="btn-success">
            <Icono nombre="venta" /> Registrar venta
          </Link>
        }
      />

      <div className="reveal reveal-2 mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="label !mb-0.5">{hayFiltros ? 'Total de lo filtrado' : 'Total de ventas'}</p>
          <p className="font-mono text-2xl font-semibold tabular-nums text-accent-strong">
            {formatMoneyFirmado(resumen.totalCentavos)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">
            {resumen.cantidad} comprobante{resumen.cantidad !== 1 ? 's' : ''}
            {' · '}asignadas: <span className="tabular-nums">{formatMoneyFirmado(resumen.asignadoCentavos)}</span> ({resumen.asignadas})
            {resumen.sinTipoCambio > 0 && (
              <span className="text-amber-700"> · {resumen.sinTipoCambio} en moneda extranjera sin TC, fuera del total</span>
            )}
          </p>
        </div>
        <div className="card p-4 sm:col-span-2 flex items-center">
          <p className="text-[13px] text-ink-mute leading-relaxed">
            Solo lo <strong className="text-tinta">asignado</strong> impacta el resultado. Las notas de crédito de
            venta restan automáticamente: el signo se deriva del tipo de comprobante, nunca se tipea.
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
              <th>Fecha</th>
              <th>Descripción / cliente</th>
              <th>Comprobante</th>
              <th>Categoría</th>
              <th>Asignación</th>
              <th>Estado</th>
              <th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id} className={v.estado === 'ANULADO' ? 'opacity-50' : ''}>
                <td className="whitespace-nowrap font-mono text-[12.5px]">{formatFecha(v.fechaDevengamiento)}</td>
                <td>
                  <span className="font-medium">{v.contraparte?.razonSocial ?? v.descripcion ?? '—'}</span>
                  {v.contraparte && v.descripcion && <span className="text-ink-mute"> — {v.descripcion}</span>}
                </td>
                <td className="whitespace-nowrap font-mono text-[12.5px]">
                  {v.tipoComprobante?.replace(/_/g, ' ') ?? '—'} {v.puntoVenta ? `${v.puntoVenta}-` : ''}{v.numero ?? ''}
                </td>
                <td className="text-ink-mute">{v.categoria?.nombre ?? '—'}</td>
                <td className="text-[12px] text-ink-mute">
                  {v.lineas.map((l, i) => (
                    <span key={l.id}>
                      {i > 0 && ' · '}
                      {l.cliente?.nombre ?? 'sin cliente'} {Number(l.porcentaje).toLocaleString('es-AR')}%
                    </span>
                  ))}
                </td>
                <td><EstadoBadge estado={v.estado} /></td>
                <td className="num font-medium text-accent-strong">{formatMoney(v.total ? Number(v.total) : null)}</td>
                <td className="text-right">
                  {esValidador && (
                    <Link href={`/${params.empresaSlug}/validacion/${v.id}`} className="text-[12.5px] underline underline-offset-2 text-accent-strong hover:text-accent">
                      {v.estado === 'PENDIENTE_VALIDACION' ? 'Validar' : 'Ver'}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {ventas.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-ink-mute">
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
                <td colSpan={8} className="py-3 text-center text-[12px] text-ink-mute">
                  Se muestran las {ventas.length} más recientes de {resumen.cantidad}; el total de arriba las incluye a todas. Afiná el filtro para ver el resto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
