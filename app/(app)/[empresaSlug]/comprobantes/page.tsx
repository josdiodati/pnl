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
  ladoDe,
  PROBLEMAS,
  type FiltrosComprobantes,
} from '@/lib/comprobantes/query';
import { mapaCobranza, hoyUtc } from '@/lib/cobranzas/query';
import { hayFiltroCobranza, idsPorFiltroCobranza, describirFiltroCobranza } from '@/lib/cobranzas/filtros';
import { CobroBadge } from '@/components/cobro-badge';

// Comprobantes: el documento fiscal (compras, ventas o ambos) en todo su
// ciclo, con buscador (incluye el texto del documento), filtros fiscales y de
// calidad, totales de lo filtrado y exportación. Es el destino de los
// drill-down: Cobranzas linkea acá con filtros (cobro, tramo, semana) que dejan
// sólo las facturas detrás de cada número. Movimientos, en cambio, es el libro.

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
  // Un filtro de cobranza sólo tiene sentido sobre ventas: fuerza el lado.
  const filtroCobranza = { cobro: searchParams.cobro, tramo: searchParams.tramo, semana: searchParams.semana };
  const drill = hayFiltroCobranza(filtroCobranza);
  const lado = drill ? 'ventas' : ladoDe(searchParams.lado);
  const conVentas = lado !== 'compras';
  const hoy = hoyUtc();
  const cobranza = conVentas && esValidador ? await mapaCobranza(ctx.db, hoy) : null;
  const ids = cobranza ? await idsPorFiltroCobranza(cobranza, filtroCobranza, hoy) : null;
  const f: FiltrosComprobantes = { ...searchParams, lado };
  const opts = { esValidador, usuarioId: ctx.usuario.id, ids };
  const where = buildWhereComprobantes(f, opts);

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
        contraparte: { select: { razonSocial: true } }, extraccionRaw: true, origen: true,
      },
    }),
    ctx.db.movimiento.groupBy({ by: ['estado'], where: buildWhereComprobantesSinEstado(f, opts), _count: { _all: true } }),
    ctx.db.contraparte.findMany({
      where: { activa: true, ...(lado === 'compras' ? { tipo: { not: 'CLIENTE' } } : lado === 'ventas' ? { tipo: { not: 'PROVEEDOR' } } : {}) },
      orderBy: { razonSocial: 'asc' },
    }),
    ctx.db.categoria.findMany({
      where: { activa: true, ...(lado === 'compras' ? { tipo: 'EGRESO' } : lado === 'ventas' ? { tipo: 'INGRESO' } : {}) },
      orderBy: { nombre: 'asc' },
    }),
  ]);
  // La contraparte: el emisor en una compra, el receptor en una venta.
  const nombreEmisor = (c: { contraparte: { razonSocial: string } | null; extraccionRaw: unknown; origen: string }) => {
    const raw = c.extraccionRaw as { razonSocialEmisor?: string; razonSocialReceptor?: string } | null;
    return c.contraparte?.razonSocial ?? (c.origen === 'COMPROBANTE' ? raw?.razonSocialEmisor : raw?.razonSocialReceptor) ?? 'Sin identificar';
  };
  const resumen = resumirComprobantes(paraResumen.map((c) => ({ ...c, proveedor: nombreEmisor(c) })));
  const conteo = Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all])) as Record<string, number>;
  const vigentes = Object.entries(conteo).filter(([e]) => e !== 'DUPLICADO' && e !== 'ANULADO').reduce((s, [, n]) => s + n, 0);
  const aRevisar = [...A_REVISAR].reduce((s, e) => s + (conteo[e] ?? 0), 0);

  const hayFiltros = drill || Boolean(
    searchParams.q?.trim() || searchParams.desde || searchParams.hasta || searchParams.contraparteId || searchParams.categoriaId
      || searchParams.canal || searchParams.moneda || searchParams.problema,
  );
  const base = `/${params.empresaSlug}/comprobantes`;
  const conParam = (clave: keyof FiltrosComprobantes, valor: string) => {
    const sp = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== clave) as [string, string][]);
    if (valor) sp.set(clave, valor);
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const qsExport = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  // Cambiar de lado conserva búsqueda y fechas, y suelta los filtros propios de un lado.
  const hrefLado = (l: string) => {
    const sp = new URLSearchParams();
    for (const k of ['q', 'desde', 'hasta', 'moneda', 'canal'] as const) if (searchParams[k]) sp.set(k, searchParams[k]!);
    if (l !== 'compras') sp.set('lado', l);
    const q = sp.toString();
    return q ? `${base}?${q}` : base;
  };
  const sinDrill = (() => {
    const sp = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !['cobro', 'tramo', 'semana'].includes(k)) as [string, string][]);
    return `${base}?${sp.toString()}`;
  })();
  const titulo = lado === 'compras' ? 'Comprobantes de compra' : lado === 'ventas' ? 'Comprobantes de venta' : 'Comprobantes';
  const etiquetaContraparte = lado === 'compras' ? 'Proveedor' : lado === 'ventas' ? 'Cliente' : 'Contraparte';
  let aCobrar = 0;
  if (cobranza) for (const c of comprobantes) { const i = cobranza.get(c.id); if (i && (i.estado === 'PENDIENTE' || i.estado === 'PARCIAL')) aCobrar += i.saldoArs ?? 0; }

  return (
    <div>
      <PageHeader
        titulo={titulo}
        descripcion="Cada comprobante desde que llega hasta que se asigna, con su detalle fiscal y el documento original a un click. Movimientos es el libro (sólo lo asignado, de todas las fuentes); esta vista es el registro de comprobantes."
        acciones={
          <div className="flex flex-wrap gap-2">
            <a href={`${base}/export${qsExport ? `?${qsExport}` : ''}`} className="btn-secondary">
              Exportar {lado === 'compras' ? 'IVA compras' : lado === 'ventas' ? 'IVA ventas' : 'comprobantes'} (XLSX)
            </a>
            <Link href={`/${params.empresaSlug}/carga`} className="btn-primary">
              <Icono nombre="carga" /> Subir comprobantes
            </Link>
          </div>
        }
      />

      <div className="reveal reveal-2 mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded border border-line bg-surface p-0.5 text-[13px]">
          {(['compras', 'ventas', 'todos'] as const).map((l) => (
            <Link
              key={l}
              href={hrefLado(l)}
              className={`rounded px-3 py-1 ${lado === l ? 'bg-ink text-paper' : 'text-ink-mute hover:text-tinta'}`}
            >
              {l === 'compras' ? 'Compras' : l === 'ventas' ? 'Ventas' : 'Todos'}
            </Link>
          ))}
        </div>
        {drill && (
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12.5px] text-accent-strong">
            Desde Cobranzas: {describirFiltroCobranza(filtroCobranza)}
            <Link href={sinDrill} className="text-ink-mute hover:text-tinta" aria-label="Quitar el filtro de Cobranzas">×</Link>
          </span>
        )}
      </div>

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
          <p className="label !mb-0.5">{lado === 'compras' ? 'IVA crédito fiscal' : lado === 'ventas' ? 'IVA débito fiscal' : 'IVA de lo listado'}</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(resumen.ivaArs)}</p>
          <p className="mt-1 text-[11px] text-ink-mute">percepciones: {formatMoney(resumen.percepcionesArs)}</p>
        </div>
        {cobranza && lado === 'ventas' ? (
          <div className="card p-4">
            <p className="label !mb-0.5">A cobrar de lo listado</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(aCobrar)}</p>
            <p className="mt-1 text-[11px] text-ink-mute">
              saldo con IVA · <Link href={`/${params.empresaSlug}/cobranzas`} className="underline underline-offset-2 hover:text-tinta">ver Cobranzas</Link>
            </p>
          </div>
        ) : (
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
        )}
        <div className="card p-4">
          <p className="label !mb-1">{lado === 'compras' ? 'Mayores proveedores' : lado === 'ventas' ? 'Mayores clientes' : 'Mayores contrapartes'}</p>
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
        {lado !== 'compras' && <input type="hidden" name="lado" value={lado} />}
        {(['cobro', 'tramo', 'semana'] as const).map((k) => searchParams[k] && <input key={k} type="hidden" name={k} value={searchParams[k]} />)}
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q ?? ''}
          className="input !w-auto min-w-[18rem] text-xs"
          placeholder={`Buscar: ${etiquetaContraparte.toLowerCase()}, CUIT, número, archivo o texto del documento…`}
        />
        <input type="date" name="desde" defaultValue={searchParams.desde ?? ''} className="input !w-auto text-xs" title="Emitido desde" />
        <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ''} className="input !w-auto text-xs" title="Emitido hasta" />
        <select name="contraparteId" defaultValue={searchParams.contraparteId ?? ''} className="input !w-auto max-w-[14rem] text-xs">
          <option value="">{lado === 'compras' ? 'Todos los proveedores' : lado === 'ventas' ? 'Todos los clientes' : 'Todas las contrapartes'}</option>
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
              <th>{etiquetaContraparte}</th>
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
                      {cobranza?.get(m.id) && cobranza.get(m.id)!.estado !== 'NO_APLICA' && (() => {
                        const i = cobranza.get(m.id)!;
                        return (
                          <span className="w-full">
                            <CobroBadge estado={i.estado} vencida={i.vencida} diasVencida={i.diasVencida} />
                            {i.estado === 'PARCIAL' && <span className="ml-1 text-[10px] text-ink-mute">saldo {formatMoney(i.saldo)}</span>}
                            {i.chequesEnCartera.map((c, k) => (
                              <span key={k} className="block text-[10px] text-ink-mute">
                                cheque en cartera {formatMoney(c.importeArs)} · acredita {formatFecha(c.fechaAcreditacion)}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
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
                      <>
                        <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="text-[12.5px] underline underline-offset-2 text-accent-strong hover:text-accent">
                          {A_REVISAR.has(m.estado) ? 'Revisar' : 'Ver'}
                        </Link>
                        {m.origen !== 'COMPROBANTE' && (
                          <Link href={`/${params.empresaSlug}/ventas/${m.id}/cobros?volver=${encodeURIComponent(`comprobantes?${qsExport}`)}`} className="mt-1 block text-[12.5px] underline underline-offset-2 text-ink-mute hover:text-tinta">
                            Cobros
                          </Link>
                        )}
                      </>
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
