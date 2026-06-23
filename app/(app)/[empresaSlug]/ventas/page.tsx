import Link from 'next/link';
import type { EstadoMovimiento, Prisma } from '@prisma/client';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { EstadoBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { Icono } from '@/components/iconos';
import { formatMoney, formatMoneyFirmado, formatFecha } from '@/lib/format';
import { periodoDeFecha, nombrePeriodo } from '@/lib/periodos';
import { totalFirmadoDe } from '@/lib/movimientos/query';

// Sales register (origen=VENTA_MANUAL): list + month summary. Reading sales
// automatically from ARCA is next-stage scope.
export default async function VentasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { estado?: string; contraparteId?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const where: Prisma.MovimientoWhereInput = {
    origen: { in: ['VENTA_MANUAL', 'VENTA_COMPROBANTE'] },
    ...(esValidador ? {} : { creadoPorId: ctx.usuario.id }),
    ...(searchParams.estado ? { estado: searchParams.estado as EstadoMovimiento } : {}),
    ...(searchParams.contraparteId ? { contraparteId: searchParams.contraparteId } : {}),
  };

  const hoy = new Date();
  const { anio, mes } = periodoDeFecha(hoy);
  const desdeMes = new Date(Date.UTC(anio, mes - 1, 1));
  const hastaMes = new Date(Date.UTC(anio, mes, 1));

  const [ventas, clientes, delMes] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { contraparte: true, categoria: true, lineas: { include: { cliente: true } } },
      orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    }),
    ctx.db.contraparte.findMany({ where: { activa: true, tipo: { not: 'PROVEEDOR' } }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.movimiento.findMany({
      where: { origen: { in: ['VENTA_MANUAL', 'VENTA_COMPROBANTE'] }, estado: 'VALIDADO', fechaDevengamiento: { gte: desdeMes, lt: hastaMes } },
      include: { categoria: true, lineas: true },
    }),
  ]);

  const totalMesCentavos = delMes.reduce((acc, m) => acc + (totalFirmadoDe(m as never) ?? 0), 0);

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
          <p className="label !mb-0.5">Ventas validadas — {nombrePeriodo(anio, mes)}</p>
          <p className="font-mono text-2xl font-semibold tabular-nums text-accent-strong">
            {formatMoneyFirmado(totalMesCentavos)}
          </p>
          <p className="mt-1 text-[11px] text-ink-mute">{delMes.length} comprobante{delMes.length !== 1 ? 's' : ''} del mes</p>
        </div>
        <div className="card p-4 sm:col-span-2 flex items-center">
          <p className="text-[13px] text-ink-mute leading-relaxed">
            Solo lo <strong className="text-tinta">validado</strong> impacta el resultado. Las notas de crédito de
            venta restan automáticamente: el signo se deriva del tipo de comprobante, nunca se tipea.
          </p>
        </div>
      </div>

      <form method="get" className="reveal reveal-2 mb-3 flex flex-wrap gap-1.5">
        <select name="estado" defaultValue={searchParams.estado ?? ''} className="input !w-auto text-xs">
          <option value="">Todos los estados</option>
          <option value="PENDIENTE_VALIDACION">Pendientes</option>
          <option value="VALIDADO">Validadas</option>
          <option value="ANULADO">Anuladas</option>
        </select>
        <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto text-xs">
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.razonSocial}</option>
          ))}
        </select>
        <button className="btn-secondary text-xs">Filtrar</button>
      </form>

      <div className="reveal reveal-3 card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
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
                <td className="font-medium">{v.contraparte?.razonSocial ?? '—'}</td>
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
                  Sin ventas registradas todavía.{' '}
                  <Link href={`/${params.empresaSlug}/asientos?tab=venta`} className="underline text-accent-strong">
                    Registrá la primera
                  </Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
