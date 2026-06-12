import Link from 'next/link';
import type { EstadoMovimiento, Prisma } from '@prisma/client';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { EstadoBadge, ArcaBadge, CanalBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { Icono } from '@/components/iconos';
import { formatMoney, formatFecha } from '@/lib/format';

// Dedicated list of captured vouchers (origen=COMPROBANTE) with the pipeline
// at a glance. Loaders see only their own uploads.

const ESTADOS: { valor: EstadoMovimiento | ''; label: string }[] = [
  { valor: '', label: 'Todos' },
  { valor: 'INGRESADO', label: 'Ingresados' },
  { valor: 'PROCESANDO', label: 'Procesando' },
  { valor: 'PENDIENTE_VALIDACION', label: 'Pendientes' },
  { valor: 'RETENIDO', label: 'Retenidos' },
  { valor: 'OBSERVADO', label: 'Observados' },
  { valor: 'VALIDADO', label: 'Validados' },
  { valor: 'ANULADO', label: 'Anulados' },
  { valor: 'ERROR_PROCESAMIENTO', label: 'Errores' },
];

export default async function ComprobantesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { estado?: string; contraparteId?: string; canal?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const where: Prisma.MovimientoWhereInput = {
    origen: 'COMPROBANTE',
    ...(esValidador ? {} : { creadoPorId: ctx.usuario.id }),
    ...(searchParams.estado ? { estado: searchParams.estado as EstadoMovimiento } : {}),
    ...(searchParams.contraparteId ? { contraparteId: searchParams.contraparteId } : {}),
    ...(searchParams.canal ? { canalIngreso: searchParams.canal } : {}),
  };

  const [comprobantes, contrapartes, porEstado] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { contraparte: true, categoria: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.movimiento.groupBy({
      by: ['estado'],
      where: { origen: 'COMPROBANTE', ...(esValidador ? {} : { creadoPorId: ctx.usuario.id }) },
      _count: { _all: true },
    }),
  ]);
  const conteo = Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all]));

  return (
    <div>
      <PageHeader
        titulo="Comprobantes"
        descripcion="Todo lo capturado por web, foto, email y Telegram, con su estado en el pipeline. El documento original es inmutable y siempre está a un click."
        acciones={
          <Link href={`/${params.empresaSlug}/carga`} className="btn-primary">
            <Icono nombre="carga" /> Subir comprobantes
          </Link>
        }
      />

      <div className="reveal reveal-2 mb-4 flex flex-wrap items-center gap-1.5">
        {ESTADOS.map((e) => {
          const activo = (searchParams.estado ?? '') === e.valor;
          const cantidad = e.valor ? conteo[e.valor] ?? 0 : comprobantes.length;
          if (e.valor && !conteo[e.valor]) return null;
          return (
            <Link
              key={e.valor}
              href={e.valor ? `?estado=${e.valor}` : `/${params.empresaSlug}/comprobantes`}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                activo
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-surface text-ink-mute hover:border-ink-mute'
              }`}
            >
              {e.label} <span className="font-mono text-[11px]">{cantidad}</span>
            </Link>
          );
        })}
        <form method="get" className="ml-auto flex gap-1.5">
          {searchParams.estado && <input type="hidden" name="estado" value={searchParams.estado} />}
          <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto text-xs">
            <option value="">Todas las contrapartes</option>
            {contrapartes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
          <select name="canal" defaultValue={searchParams.canal ?? ''} className="input !w-auto text-xs">
            <option value="">Todos los canales</option>
            {['WEB', 'FOTO', 'EMAIL', 'TELEGRAM'].map((c) => (
              <option key={c} value={c}>{c === 'WEB' ? 'Web' : c === 'FOTO' ? 'Foto' : c === 'EMAIL' ? 'Email' : 'Telegram'}</option>
            ))}
          </select>
          <button className="btn-secondary text-xs">Filtrar</button>
        </form>
      </div>

      <div className="reveal reveal-3 card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Contraparte / emisor</th>
              <th>Fecha</th>
              <th>Categoría</th>
              <th>Estado</th>
              <th>Canal</th>
              <th className="text-right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {comprobantes.map((m) => {
              const extr = m.extraccionRaw as { razonSocialEmisor?: string } | null;
              const duplicado = (((m.flags as { duplicados?: string[] } | null)?.duplicados) ?? []).length > 0;
              return (
                <tr key={m.id} className={m.estado === 'ANULADO' ? 'opacity-50' : ''}>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <Icono nombre="comprobante" className="w-4 h-4 text-ink-mute" />
                      <span className="font-mono text-[12.5px]">
                        {m.tipoComprobante ? m.tipoComprobante.replace(/_/g, ' ') : '—'}
                        {m.numero ? ` ${m.puntoVenta ?? ''}${m.puntoVenta ? '-' : ''}${m.numero}` : ''}
                      </span>
                    </span>
                  </td>
                  <td className="font-medium">
                    {m.contraparte?.razonSocial ?? extr?.razonSocialEmisor ?? <span className="text-ink-mute/60">Sin identificar</span>}
                    {duplicado && (
                      <span className="ml-1.5 rounded bg-red-100 px-1.5 py-px text-[10px] font-semibold text-red-800">⚠ duplicado</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12.5px]">{formatFecha(m.fechaDevengamiento)}</td>
                  <td className="text-ink-mute">{m.categoria?.nombre ?? '—'}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    <EstadoBadge estado={m.estado} />
                    {m.cae && <ArcaBadge estado={m.arcaEstado} />}
                  </td>
                  <td><CanalBadge canal={m.canalIngreso} /></td>
                  <td className="num font-medium">{formatMoney(m.total ? Number(m.total) : null)}</td>
                  <td className="text-right whitespace-nowrap">
                    {esValidador ? (
                      <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="text-[12.5px] underline underline-offset-2 text-accent-strong hover:text-accent">
                        {['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO'].includes(m.estado) ? 'Revisar' : 'Ver'}
                      </Link>
                    ) : (
                      <span className="text-[11px] text-ink-mute/60">{m.archivoNombre ?? ''}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {comprobantes.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-ink-mute">
                  No hay comprobantes para estos filtros.{' '}
                  <Link href={`/${params.empresaSlug}/carga`} className="underline text-accent-strong">Subí el primero</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {comprobantes.length === 300 && (
        <p className="mt-2 text-xs text-amber-700">Se muestran los últimos 300; afiná los filtros.</p>
      )}
    </div>
  );
}
