import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { buildWhereMovimientos, resumirMovimientos, totalFirmadoDe, type FiltrosMovimientos } from '@/lib/movimientos/query';
import { formatMoney, formatMoneyFirmado, formatFecha } from '@/lib/format';
import { EstadoBadge, CanalBadge } from '@/components/badges';
import { OkBanner } from '@/components/error-banner';

// Minimal reporting view (doc 09): filterable table + selection totals +
// mini-summary with cost-center breakdown + CSV export. No formatted P&L.
export default async function MovimientosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: FiltrosMovimientos & { ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const where = buildWhereMovimientos(searchParams, { esValidador, usuarioId: ctx.usuario.id });
  const [movimientos, categorias, centros, clientes, contrapartes] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { categoria: true, contraparte: true, lineas: true },
      orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.contraparte.findMany({ orderBy: { razonSocial: 'asc' } }),
  ]);

  const resumen = resumirMovimientos(movimientos as never);
  const qs = new URLSearchParams(
    Object.entries(searchParams).filter(([k, v]) => v && k !== 'ok') as [string, string][],
  ).toString();

  const filtros: { name: keyof FiltrosMovimientos; label: string; opciones: { id: string; nombre: string }[] }[] = [
    { name: 'categoriaId', label: 'Categoría', opciones: categorias.map((c) => ({ id: c.id, nombre: `${c.nombre} (${c.tipo})` })) },
    { name: 'centroCostoId', label: 'Centro de costo', opciones: centros.map((c) => ({ id: c.id, nombre: c.nombre })) },
    { name: 'clienteId', label: 'Cliente / proyecto', opciones: clientes.map((c) => ({ id: c.id, nombre: c.nombre })) },
    { name: 'contraparteId', label: 'Contraparte', opciones: contrapartes.map((c) => ({ id: c.id, nombre: c.razonSocial })) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Movimientos</h1>
          <p className="text-xs text-slate-500">Libro de movimientos validados y asignados. Lo pendiente vive en las colas de Validación y Asignación.</p>
        </div>
        <a href={`/${params.empresaSlug}/movimientos/export${qs ? `?${qs}` : ''}`} className="btn-secondary text-sm">
          Exportar CSV
        </a>
      </div>
      <OkBanner mensaje={searchParams.ok} />

      {/* Mini-summary over the validated movements of the selection */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-500">Ingresos (asignados)</p>
          <p className="text-xl font-semibold tabular-nums text-emerald-700">{formatMoneyFirmado(resumen.ingresos)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500">Egresos (asignados)</p>
          <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoneyFirmado(resumen.egresos)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500">Resultado</p>
          <p className={`text-xl font-semibold tabular-nums ${resumen.resultado >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatMoneyFirmado(resumen.resultado)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 space-x-2">
            {[...resumen.porCentroCosto.entries()].map(([ccId, total]) => (
              <span key={ccId} className="whitespace-nowrap">
                {centros.find((c) => c.id === ccId)?.nombre ?? '?'}: <span className="tabular-nums">{formatMoneyFirmado(total)}</span>
              </span>
            ))}
          </p>
        </div>
      </div>

      <form method="get" className="card p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
        <div>
          <label className="label">Desde</label>
          <input type="date" name="desde" defaultValue={searchParams.desde} className="input text-xs" />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" name="hasta" defaultValue={searchParams.hasta} className="input text-xs" />
        </div>
        {filtros.map((f) => (
          <div key={f.name}>
            <label className="label">{f.label}</label>
            <select name={f.name} defaultValue={searchParams[f.name] ?? ''} className="input text-xs">
              <option value="">Todos</option>
              {f.opciones.map((o) => (
                <option key={o.id} value={o.id}>{o.nombre}</option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <label className="label">Origen</label>
          <select name="origen" defaultValue={searchParams.origen ?? ''} className="input text-xs">
            <option value="">Todos</option>
            <option value="COMPROBANTE">Comprobante</option>
            <option value="ASIENTO_MANUAL">Asiento manual</option>
            <option value="VENTA_MANUAL">Venta manual</option>
          </select>
        </div>
        <div>
          <label className="label">Estado</label>
          <select name="estado" defaultValue={searchParams.estado ?? ''} className="input text-xs">
            <option value="">Validados y asignados</option>
            <option value="VALIDADO">Solo validados</option>
            <option value="ASIGNADO">Solo asignados</option>
          </select>
        </div>
        <div className="flex gap-1">
          <button className="btn-primary text-xs">Filtrar</button>
          <Link href={`/${params.empresaSlug}/movimientos`} className="btn-secondary text-xs">Limpiar</Link>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Descripción / contraparte</th>
              <th>Categoría</th>
              <th>Asignación</th>
              <th>Origen</th>
              <th>Estado</th>
              <th>Canal</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              const firmado = totalFirmadoDe(m as never);
              return (
                <tr key={m.id} className={`hover:bg-slate-50 ${m.estado === 'ANULADO' ? 'opacity-50' : ''}`}>
                  <td className="whitespace-nowrap">{formatFecha(m.fechaDevengamiento)}</td>
                  <td>
                    <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="hover:underline">
                      <span className="font-medium">{m.contraparte?.razonSocial ?? m.descripcion ?? 'Sin descripción'}</span>
                      {m.contraparte && m.descripcion && <span className="text-slate-500"> — {m.descripcion}</span>}
                    </Link>
                    {m.numero && (
                      <span className="text-xs text-slate-400 ml-1">
                        {m.tipoComprobante?.replace(/_/g, ' ')} {m.puntoVenta ? `${m.puntoVenta}-` : ''}{m.numero}
                      </span>
                    )}
                  </td>
                  <td>{m.categoria?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-500">
                    {m.lineas.map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && ' · '}
                        {centros.find((c) => c.id === l.centroCostoId)?.nombre ?? '?'}
                        {l.clienteId ? `/${clientes.find((c) => c.id === l.clienteId)?.nombre ?? '?'}` : ''}{' '}
                        {Number(l.porcentaje).toLocaleString('es-AR')}%
                      </span>
                    ))}
                  </td>
                  <td className="text-xs text-slate-500 whitespace-nowrap">
                    {m.origen === 'COMPROBANTE' ? 'Comprobante' : m.origen === 'ASIENTO_MANUAL' ? 'Asiento' : 'Venta'}
                  </td>
                  <td><EstadoBadge estado={m.estado} /></td>
                  <td><CanalBadge canal={m.canalIngreso} /></td>
                  <td className={`num font-medium ${firmado != null && firmado < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {firmado != null ? formatMoneyFirmado(firmado) : formatMoney(m.total ? Number(m.total) : null)}
                  </td>
                </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-8">Sin movimientos para los filtros elegidos</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td colSpan={7} className="text-right text-sm text-slate-500">
                Totales de la selección ({movimientos.length} mov.) — solo asignados:
              </td>
              <td className={`num ${resumen.resultado < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {formatMoneyFirmado(resumen.resultado)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {movimientos.length === 500 && (
        <p className="text-xs text-amber-600">Se muestran los primeros 500 movimientos; afiná los filtros o usá el export CSV.</p>
      )}
    </div>
  );
}
