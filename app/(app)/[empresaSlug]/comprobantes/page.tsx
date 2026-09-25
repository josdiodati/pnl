import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { EstadoBadge, ArcaBadge, CanalBadge, QrBadge } from '@/components/badges';
import { PageHeader } from '@/components/page-header';
import { Icono } from '@/components/iconos';
import { formatMoney, formatFecha } from '@/lib/format';
import { ESTADO_LABEL } from '@/lib/movimientos/estados';
import {
  buildWhereComprobantes,
  buildWhereComprobantesSinEstado,
  resumirComprobantes,
  PROBLEMAS,
  type FiltrosComprobantes,
} from '@/lib/comprobantes/query';

// Registro de compras: el documento fiscal de compra en todo su ciclo, con
// buscador (incluye el texto del documento), filtros fiscales y de calidad,
// totales de lo filtrado (total, IVA crédito fiscal, neto) y exportación.
// Movimientos, en cambio, es el libro: sólo lo asignado, de todas las fuentes.

const MAX_FILAS = 300;
const ORDEN_ESTADOS = ['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'ERROR_PROCESAMIENTO', 'PROCESANDO', 'INGRESADO', 'VALIDADO', 'ASIGNADO', 'DUPLICADO', 'ANULADO'];
const A_REVISAR = new Set(['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'ERROR_PROCESAMIENTO']);

export default async function ComprobantesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: FiltrosComprobantes;
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');
  const opts = { esValidador, usuarioId: ctx.usuario.id };
  const where = buildWhereComprobantes(searchParams, opts);

  const [comprobantes, paraResumen, porEstado, contrapartes, categorias] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { contraparte: true, categoria: true, lineas: { include: { centroCosto: true, cliente: true } }, creadoPor: { select: { nombre: true } } },
      orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
      take: MAX_FILAS,
    }),
    ctx.db.movimiento.findMany({
      where,
      select: {
        estado: true, moneda: true, tipoCambio: true, tipoComprobante: true, total: true, netoGravado: true,
        iva21: true, iva105: true, iva27: true, percepcionesIva: true, percepcionesIibb: true, otrosTributos: true,
        contraparte: { select: { razonSocial: true } }, extraccionRaw: true,
      },
    }),
    ctx.db.movimiento.groupBy({ by: ['estado'], where: buildWhereComprobantesSinEstado(searchParams, opts), _count: { _all: true } }),
    ctx.db.contraparte.findMany({ where: { activa: true, tipo: { not: 'CLIENTE' } }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.categoria.findMany({ where: { activa: true, tipo: 'EGRESO' }, orderBy: { nombre: 'asc' } }),
  ]);
  const nombreEmisor = (c: { contraparte: { razonSocial: string } | null; extraccionRaw: unknown }) =>
    c.contraparte?.razonSocial ?? (c.extraccionRaw as { razonSocialEmisor?: string } | null)?.razonSocialEmisor ?? 'Sin identificar';
  const resumen = resumirComprobantes(paraResumen.map((c) => ({ ...c, proveedor: nombreEmisor(c) })));
  const conteo = Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all])) as Record<string, number>;
  const vigentes = Object.entries(conteo).filter(([e]) => e !== 'DUPLICADO' && e !== 'ANULADO').reduce((s, [, n]) => s + n, 0);
  const aRevisar = [...A_REVISAR].reduce((s, e) => s + (conteo[e] ?? 0), 0);

  const hayFiltros = Boolean(
    searchParams.q?.trim() || searchParams.desde || searchParams.hasta || searchParams.contraparteId || searchParams.categoriaId
      || searchParams.canal || searchParams.moneda || searchParams.problema,
  );
  const base = `/${params.empresaSlug}/comprobantes`;
  const conParam = (clave: keyof FiltrosComprobantes, valor: string) => {
    const sp = new URLSearchParams(Object.entries(searchParams).filter(([k, v]) => v && k !== clave) as [string, string][]);
    if (valor) sp.set(clave, valor);
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const qsExport = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div>
      <PageHeader
        titulo="Comprobantes de compra"
        descripcion="Cada factura de proveedor desde que llega hasta que se asigna, con su detalle fiscal y el documento original a un click. Movimientos es el libro (sólo lo asignado, de todas las fuentes); esta vista es el registro de compras."
        acciones={
          <div className="flex flex-wrap gap-2">
            <a href={`${base}/export${qsExport ? `?${qsExport}` : ''}`} className="btn-secondary">Exportar IVA compras (XLSX)</a>
            <Link href={`/${params.empresaSlug}/carga`} className="btn-primary">
              <Icono nombre="carga" /> Subir comprobantes
            </Link>
          </div>
        }
      />

      <div className="reveal reveal-2 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="label !mb-0.5">Total con IVA</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(resumen.totalArs)}</p>
          <p className="mt-1 text-[11px] text-ink-mute">
            {resumen.cantidad} comprobante{resumen.cantidad !== 1 ? 's' : ''}{hayFiltros ? ' filtrados' : ''} · neto {formatMoney(resumen.netoArs)}
            {resumen.sinTipoCambio > 0 && <span className="text-amber-700"> · {resumen.sinTipoCambio} sin TC, fuera del total</span>}
          </p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">IVA crédito fiscal</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(resumen.ivaArs)}</p>
          <p className="mt-1 text-[11px] text-ink-mute">percepciones: {formatMoney(resumen.percepcionesArs)}</p>
        </div>
        <div className="card p-4">
          <p className="label !mb-0.5">A revisar</p>
          <p className={`font-mono text-2xl font-semibold tabular-nums ${aRevisar > 0 ? 'text-amber-700' : ''}`}>{aRevisar}</p>
          <p className="mt-1 text-[11px] text-ink-mute">
            pendientes, observados, retenidos o con error
            {esValidador && aRevisar > 0 && (
              <> · <Link href={`/${params.empresaSlug}/validacion`} className="underline underline-offset-2 hover:text-tinta">ir a Validación</Link></>
            )}
          </p>
        </div>
        <div className="card p-4">
          <p className="label !mb-1">Mayores proveedores</p>
          <ol className="space-y-0.5 text-[12px]">
            {resumen.topProveedores.map((p) => (
              <li key={p.proveedor} className="flex justify-between gap-2">
                <span className="truncate" title={p.proveedor}>{p.proveedor}</span>
                <span className="font-mono tabular-nums text-ink-mute">{formatMoney(p.totalArs)}</span>
              </li>
            ))}
            {resumen.topProveedores.length === 0 && <li className="text-ink-mute">—</li>}
          </ol>
        </div>
      </div>

      <form method="get" className="reveal reveal-2 mb-2 flex flex-wrap items-center gap-1.5">
        {searchParams.estado && <input type="hidden" name="estado" value={searchParams.estado} />}
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q ?? ''}
          className="input !w-auto min-w-[18rem] text-xs"
          placeholder="Buscar: proveedor, CUIT, número, archivo o texto del documento…"
        />
        <input type="date" name="desde" defaultValue={searchParams.desde ?? ''} className="input !w-auto text-xs" title="Emitido desde" />
        <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ''} className="input !w-auto text-xs" title="Emitido hasta" />
        <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto max-w-[14rem] text-xs">
          <option value="">Todos los proveedores</option>
          {contrapartes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
        </select>
        <select name="categoriaId" defaultValue={searchParams.categoriaId ?? ''} className="input !w-auto max-w-[12rem] text-xs">
          <option value="">Todas las categorías</option>
          <option value="sin">— Sin categoría —</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select name="problema" defaultValue={searchParams.problema ?? ''} className="input !w-auto text-xs">
          <option value="">Sin filtro de calidad</option>
          {Object.entries(PROBLEMAS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
        <select name="moneda" defaultValue={searchParams.moneda ?? ''} className="input !w-auto text-xs">
          <option value="">Toda moneda</option>
          <option value="ARS">ARS</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <select name="canal" defaultValue={searchParams.canal ?? ''} className="input !w-auto text-xs">
          <option value="">Todos los canales</option>
          {['WEB', 'FOTO', 'EMAIL', 'TELEGRAM', 'MANUAL'].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
        </select>
        <button className="btn-secondary text-xs">Filtrar</button>
        {(hayFiltros || searchParams.estado) && (
          <Link href={base} className="text-xs underline underline-offset-2 text-ink-mute hover:text-tinta">Limpiar</Link>
        )}
      </form>

      <div className="reveal reveal-2 mb-4 flex flex-wrap items-center gap-1.5">
        {[['', `Vigentes`, vigentes] as const, ...ORDEN_ESTADOS.filter((e) => conteo[e]).map((e) => [e, (ESTADO_LABEL as Record<string, string>)[e] ?? e, conteo[e]] as const)].map(([valor, label, cantidad]) => {
          const activo = (searchParams.estado ?? '') === valor;
          return (
            <Link
              key={valor || 'vigentes'}
              href={conParam('estado', valor)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                activo ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink-mute hover:border-ink-mute'
              }`}
            >
              {label} <span className="font-mono text-[11px]">{cantidad}</span>
            </Link>
          );
        })}
      </div>

      <div className="reveal reveal-3 card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Emisión</th>
              <th>Proveedor</th>
              <th>Comprobante</th>
              <th>Categoría · asignación</th>
              <th>Estado</th>
              <th className="text-right">Neto · IVA</th>
              <th className="text-right">Total</th>
              <th>Carga</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {comprobantes.map((m) => {
              const duplicado = m.estado === 'DUPLICADO' || (((m.flags as { duplicados?: string[] } | null)?.duplicados) ?? []).length > 0;
              const iva = [m.iva21, m.iva105, m.iva27].reduce((s: number, v) => s + (v == null ? 0 : Number(v)), 0);
              const ext = m.moneda === 'ARS' ? '' : ` ${m.moneda}`;
              const cuit = m.contraparte?.cuit ?? m.cuitEmisor;
              return (
                <tr key={m.id} className={m.estado === 'ANULADO' || m.estado === 'DUPLICADO' ? 'opacity-60' : ''}>
                  <td className="whitespace-nowrap font-mono text-[12.5px]">{formatFecha(m.fechaDevengamiento)}</td>
                  <td>
                    <span className="font-medium">{nombreEmisor(m)}</span>
                    {cuit && <span className="block font-mono text-[10.5px] text-ink-mute">{cuit}</span>}
                    {m.descripcion && <span className="block max-w-[18rem] truncate text-[11px] text-ink-mute" title={m.descripcion}>{m.descripcion}</span>}
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12px]">
                    {m.tipoComprobante ? m.tipoComprobante.replace(/_/g, ' ') : '—'}
                    {m.numero && <span className="block">{m.puntoVenta ? `${m.puntoVenta}-` : ''}{m.numero}</span>}
                    {m.fechaVencimientoPago && <span className="block font-sans text-[10.5px] text-ink-mute">vence {formatFecha(m.fechaVencimientoPago)}</span>}
                  </td>
                  <td className="text-ink-mute">
                    {m.categoria?.nombre ?? <span className="whitespace-nowrap text-amber-700">sin categoría</span>}
                    {m.lineas.length > 0 && (
                      <span className="block text-[11px]">
                        {m.lineas.map((l, i) => (
                          <span key={l.id}>{i > 0 && ' · '}{l.centroCosto.nombre}{l.cliente ? ` / ${l.cliente.nombre}` : ''} {Number(l.porcentaje).toLocaleString('es-AR')}%</span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <EstadoBadge estado={m.estado} />
                      {m.cae && <ArcaBadge estado={m.arcaEstado} />}
                      <QrBadge estado={m.qrEstado} />
                      {duplicado && m.estado !== 'DUPLICADO' && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">posible duplicado</span>
                      )}
                    </span>
                  </td>
                  <td className="num text-[12.5px]">
                    {m.netoGravado != null ? `${formatMoney(Number(m.netoGravado))}${ext}` : '—'}
                    {iva > 0 && <span className="block text-[10.5px] text-ink-mute">IVA {formatMoney(iva)}</span>}
                  </td>
                  <td className="num font-medium">
                    {formatMoney(m.total ? Number(m.total) : null)}{ext}
                    {m.moneda !== 'ARS' && (
                      <span className="block text-[10px] font-normal text-ink-mute">
                        {m.tipoCambio != null ? `TC ${Number(m.tipoCambio).toLocaleString('es-AR')}` : 'sin TC'}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-ink-mute">
                    <CanalBadge canal={m.canalIngreso} />
                    <span className="block">{formatFecha(m.createdAt)}</span>
                    {esValidador && m.creadoPor?.nombre && <span className="block">{m.creadoPor.nombre}</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {esValidador ? (
                      <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="text-[12.5px] underline underline-offset-2 text-accent-strong hover:text-accent">
                        {A_REVISAR.has(m.estado) ? 'Revisar' : 'Ver'}
                      </Link>
                    ) : (
                      <span className="text-[11px] text-ink-mute/60" title={m.archivoNombre ?? ''}>{m.archivoNombre ? 'documento' : ''}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {comprobantes.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-ink-mute">
                  {hayFiltros || searchParams.estado ? 'Ningún comprobante coincide con el filtro.' : (
                    <>Sin comprobantes todavía. <Link href={`/${params.empresaSlug}/carga`} className="underline text-accent-strong">Subí el primero</Link>.</>
                  )}
                </td>
              </tr>
            )}
            {resumen.cantidad > comprobantes.length && (
              <tr>
                <td colSpan={9} className="py-3 text-center text-[12px] text-ink-mute">
                  Se muestran los {comprobantes.length} más recientes de {resumen.cantidad}; los totales de arriba y la exportación los incluyen a todos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
