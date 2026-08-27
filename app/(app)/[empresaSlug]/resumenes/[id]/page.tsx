import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { getFileStorage } from '@/lib/storage';
import { MES_LABEL } from '@/lib/periodos';
import { formatMoney, formatFecha } from '@/lib/format';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { DocViewer } from '@/components/doc-viewer';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { MontoArsHint } from '@/components/monto-ars-hint';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import {
  conciliarAction,
  imputarAction,
  ignorarAction,
  deshacerAction,
  rematchearAction,
  confirmarSugeridasAction,
  rechazarCandidatoAction,
  aplicarReglasAction,
} from '../actions';

// Bandeja de conciliación de un resumen: lista de líneas con su estado de
// matching + panel por querystring (`?linea=`) para resolver cada una contra
// candidatos rankeados, un buscador manual, o crearla como gasto nuevo
// (imputación) / descartarla (ignorar). Mismo patrón de panel por querystring
// que empleados/prepagas.

const TIPO_LABEL: Record<string, string> = { TARJETA: 'Tarjeta', BANCO: 'Banco' };
const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  SUGERIDA: 'Sugerida',
  CONCILIADA: 'Conciliada',
  IMPUTADA: 'Imputada',
  IGNORADA: 'Ignorada',
};
const ESTADO_COLOR: Record<string, string> = {
  PENDIENTE: 'bg-white border border-slate-300 text-slate-600',
  SUGERIDA: 'bg-amber-100 text-amber-800',
  CONCILIADA: 'bg-emerald-100 text-emerald-800',
  IMPUTADA: 'bg-sky-100 text-sky-800',
  IGNORADA: 'bg-slate-200 text-slate-600',
};
const ESTADOS_RESUELTOS = new Set(['CONCILIADA', 'IMPUTADA', 'IGNORADA']);
const MOVIMIENTOS_CONCILIABLES = ['ASIGNADO', 'VALIDADO', 'PENDIENTE_VALIDACION'] as const;

type Candidato = { movimientoId: string; score: number; motivo: string; rechazado?: boolean };

export default async function ResumenDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { linea?: string; ver?: string; ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const base = `/${params.empresaSlug}/resumenes/${params.id}`;

  const resumen = await ctx.db.resumen.findFirst({
    where: { id: params.id },
    include: {
      periodo: true,
      lineas: { orderBy: { orden: 'asc' }, include: { movimiento: { include: { contraparte: true } } } },
    },
  });
  if (!resumen) notFound();

  // Movimientos referenciados como candidatos (de cualquier línea): se
  // resuelven de un saque para mostrar nombre/total/fecha en los chips y el
  // panel, sin una consulta por línea.
  const candidatoIds = new Set<string>();
  for (const l of resumen.lineas) {
    const cands = (l.candidatos as Candidato[] | null) ?? [];
    for (const c of cands) candidatoIds.add(c.movimientoId);
  }
  const movsCandidatos = candidatoIds.size
    ? await ctx.db.movimiento.findMany({ where: { id: { in: [...candidatoIds] } }, include: { contraparte: true } })
    : [];
  const movPorId = new Map(movsCandidatos.map((m) => [m.id, m]));

  const [categorias, centros, clientes, proyectos, contrapartes] = await Promise.all([
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
  ]);

  const fileUrl = await getFileStorage().getSignedUrl(resumen.archivoKey);
  const reglasActivas = await ctx.db.reglaResumen.count({ where: { activa: true } });

  const total = resumen.lineas.length;
  const resueltas = resumen.lineas.filter((l) => ESTADOS_RESUELTOS.has(l.estado)).length;
  const pct = total > 0 ? Math.round((resueltas / total) * 100) : 0;
  const sugeridas = resumen.lineas.filter((l) => l.estado === 'SUGERIDA').length;

  const sumaLineas = resumen.lineas.reduce((acc, l) => acc + (l.monto != null ? Number(l.monto) : 0), 0);
  const diferencia = resumen.totalDeclarado != null ? Number(resumen.totalDeclarado) - sumaLineas : null;

  // ---------- Panel de línea (querystring ?linea=) ----------
  let panel: React.ReactNode = null;
  let popup: React.ReactNode = null;
  if (searchParams.linea) {
    const linea = resumen.lineas.find((l) => l.id === searchParams.linea);
    if (linea) {
      const candidatosLinea = (linea.candidatos as Candidato[] | null) ?? [];
      const editable = linea.estado === 'PENDIENTE' || linea.estado === 'SUGERIDA';

      const movimientosManual = editable
        ? await ctx.db.movimiento.findMany({
            where: { estado: { in: [...MOVIMIENTOS_CONCILIABLES] } },
            include: { contraparte: true, lineasResumen: { where: { estado: { in: ['CONCILIADA', 'IMPUTADA'] } }, select: { id: true } } },
            orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
            take: 100,
          })
        : [];
      const opcionesManual = movimientosManual.filter((m) => m.lineasResumen.length === 0);

      panel = (
        <div className="card p-4 border-sky-200 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {linea.descriptor} · {formatFecha(linea.fecha)}
            </p>
            <Link href={base} className="text-xs text-slate-500 underline">Cerrar</Link>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">Candidatos sugeridos</p>
            {candidatosLinea.filter((c) => !c.rechazado).length === 0 && (
              <p className="text-xs text-slate-400">Sin candidatos de matching.</p>
            )}
            <div className="space-y-1">
              {candidatosLinea.filter((c) => !c.rechazado).map((c) => {
                const mov = movPorId.get(c.movimientoId);
                return (
                  <div key={c.movimientoId} className="flex items-center gap-2 text-sm border border-slate-100 rounded px-2 py-1">
                    <Link
                      href={`${base}?linea=${linea.id}&ver=${c.movimientoId}`}
                      className="flex-1 flex items-center gap-2 min-w-0 group"
                      title="Ver el comprobante propuesto"
                    >
                      <span className="flex-1 truncate group-hover:underline text-sky-700">
                        {mov ? nombreContraparte(mov).nombre ?? 'Sin identificar' : c.movimientoId}
                      </span>
                      <span className="text-xs text-slate-500 w-24 text-right tabular-nums">
                        {mov?.total != null ? formatMoney(Number(mov.total)) : '—'}
                      </span>
                      <span className="text-xs text-slate-500 w-20 whitespace-nowrap">
                        {mov ? formatFecha(mov.fechaDevengamiento ?? mov.createdAt) : ''}
                      </span>
                      <span className="text-xs text-slate-400 w-40 truncate" title={c.motivo}>{c.motivo} · {c.score}</span>
                    </Link>
                    {editable && (
                      <form action={conciliarAction}>
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="resumenId" value={resumen.id} />
                        <input type="hidden" name="lineaId" value={linea.id} />
                        <input type="hidden" name="movimientoId" value={c.movimientoId} />
                        <button className="btn-secondary text-xs">Conciliar</button>
                      </form>
                    )}
                  </div>
                );
              })}
              {candidatosLinea.filter((c) => c.rechazado).map((c) => {
                const mov = movPorId.get(c.movimientoId);
                return (
                  <div key={c.movimientoId} className="flex items-center gap-2 text-xs text-slate-400 px-2 py-1">
                    <span className="flex-1 truncate line-through">
                      {mov ? nombreContraparte(mov).nombre ?? 'Sin identificar' : c.movimientoId}
                    </span>
                    <span className="w-24 text-right tabular-nums">{mov?.total != null ? formatMoney(Number(mov.total)) : '—'}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">rechazada</span>
                  </div>
                );
              })}
            </div>
          </div>

          {editable && (
            <form action={conciliarAction} className="flex items-end gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <input type="hidden" name="resumenId" value={resumen.id} />
              <input type="hidden" name="lineaId" value={linea.id} />
              <div className="flex-1">
                <label className="label">Buscar movimiento manualmente</label>
                <select name="movimientoId" className="input" required defaultValue="">
                  <option value="" disabled>Elegí un movimiento…</option>
                  {opcionesManual.map((m) => (
                    <option key={m.id} value={m.id}>
                      {nombreContraparte(m).nombre ?? 'Sin identificar'} · {formatFecha(m.fechaDevengamiento ?? m.createdAt)} ·{' '}
                      {formatMoney(m.total != null ? Number(m.total) : null)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-secondary text-sm">Conciliar</button>
            </form>
          )}

          {editable ? (
            <>
              <form action={imputarAction} className="space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="resumenId" value={resumen.id} />
                <input type="hidden" name="lineaId" value={linea.id} />
                <p className="text-xs font-semibold text-slate-500">Imputar como gasto nuevo</p>
                <div>
                  <label className="label">Categoría</label>
                  <select name="categoriaId" className="input" required defaultValue="">
                    <option value="" disabled>Elegí una categoría…</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.padreId ? '· ' : ''}{c.nombre} ({c.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'})
                      </option>
                    ))}
                  </select>
                </div>
                <DistribucionEditor
                  centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
                  clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre, centroCostoId: c.centroCostoId }))}
                  proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, clienteId: p.clienteId }))}
                  totalFirmado={linea.monto != null ? Number(linea.monto) : null}
                />
                <div>
                  <label className="label">Contraparte (opcional)</label>
                  <select name="contraparteId" className="input" defaultValue="">
                    <option value="">Sin contraparte</option>
                    {contrapartes.map((c) => (
                      <option key={c.id} value={c.id}>{c.razonSocial}</option>
                    ))}
                  </select>
                </div>
                {linea.monto == null && (
                  <MontoArsHint
                    montoOrigen={linea.montoOrigen != null ? Number(linea.montoOrigen) : null}
                    moneda={linea.moneda}
                  />
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" name="crearRegla" value="1" />
                  Crear regla: imputar así automáticamente las líneas con este descriptor en futuros resúmenes
                </label>
                <button className="btn-primary text-sm">Imputar</button>
              </form>

              <form action={ignorarAction} className="space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="resumenId" value={resumen.id} />
                <input type="hidden" name="lineaId" value={linea.id} />
                <p className="text-xs font-semibold text-slate-500">Ignorar (no requiere imputación)</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {['Pago del resumen', 'Saldo/subtotal', 'Ya cargado a mano'].map((m) => (
                    <button
                      key={m}
                      name="motivoRapido"
                      value={m}
                      className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label">Otro motivo</label>
                    <input name="motivo" className="input" placeholder="p.ej. gasto personal" />
                  </div>
                  <button className="btn-secondary text-sm">Ignorar</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" name="crearRegla" value="1" />
                  Crear regla: ignorar automáticamente las líneas con este descriptor en futuros resúmenes
                </label>
              </form>
            </>
          ) : (
            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
              Esta línea ya está resuelta ({ESTADO_LABEL[linea.estado]}
              {linea.estado === 'IGNORADA' && linea.motivoIgnorada ? `: ${linea.motivoIgnorada}` : ''}). Para
              modificarla, deshacela desde la lista.
            </p>
          )}
        </div>
      );

      // ---------- Pop-up de verificación (?ver=<movimientoId>) ----------
      if (searchParams.ver) {
        const mov = await ctx.db.movimiento.findFirst({
          where: { id: searchParams.ver },
          include: { contraparte: true, categoria: true },
        });
        if (mov) {
          const candidato = candidatosLinea.find((c) => c.movimientoId === mov.id);
          const pdfUrl = mov.archivoKey ? await getFileStorage().getSignedUrl(mov.archivoKey) : null;
          const numeroComprobante = [mov.puntoVenta, mov.numero].filter(Boolean).join('-');
          const cerrar = `${base}?linea=${linea.id}`;
          popup = (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <Link href={cerrar} className="absolute inset-0 bg-black/40" aria-label="Cerrar" />
              <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">¿Es este el comprobante de la línea?</p>
                  <Link href={cerrar} className="text-xs text-slate-500 underline">Cerrar ✕</Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded border border-amber-200 bg-amber-50/50 p-3 space-y-1">
                    <p className="text-xs font-semibold text-amber-800">Línea del resumen</p>
                    <p className="font-medium">{linea.descriptor}</p>
                    <p className="text-slate-600">{formatFecha(linea.fecha)}</p>
                    <p className="tabular-nums">
                      {linea.monto != null
                        ? formatMoney(Number(linea.monto))
                        : linea.montoOrigen != null
                          ? `${linea.moneda} ${Math.abs(Number(linea.montoOrigen)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                          : '—'}
                    </p>
                    {(linea.cuenta || linea.titular) && (
                      <p className="text-xs text-slate-500">{[linea.cuenta, linea.titular].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="rounded border border-sky-200 bg-sky-50/50 p-3 space-y-1">
                    <p className="text-xs font-semibold text-sky-800">Movimiento propuesto</p>
                    <p className="font-medium">{nombreContraparte(mov).nombre ?? 'Sin identificar'}</p>
                    <p className="text-slate-600">
                      {[mov.tipoComprobante, numeroComprobante].filter(Boolean).join(' ') || 'Sin datos de comprobante'} ·{' '}
                      {formatFecha(mov.fechaDevengamiento ?? mov.createdAt)}
                    </p>
                    <p className="tabular-nums">
                      {mov.total != null ? `${mov.moneda !== 'ARS' ? `${mov.moneda} ` : ''}${formatMoney(Number(mov.total))}` : '—'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[mov.categoria?.nombre, mov.estado].filter(Boolean).join(' · ')}
                      {mov.descripcion ? ` · ${mov.descripcion}` : ''}
                    </p>
                  </div>
                </div>

                {candidato && (
                  <p className="text-xs text-slate-500">
                    Por qué se sugiere: <span className="font-medium">{candidato.motivo}</span> · score {candidato.score}
                  </p>
                )}

                {editable && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <form action={conciliarAction}>
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="resumenId" value={resumen.id} />
                      <input type="hidden" name="lineaId" value={linea.id} />
                      <input type="hidden" name="movimientoId" value={mov.id} />
                      <button className="btn-primary text-sm">Aceptar y conciliar</button>
                    </form>
                    {candidato && !candidato.rechazado && (
                      <form action={rechazarCandidatoAction}>
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="resumenId" value={resumen.id} />
                        <input type="hidden" name="lineaId" value={linea.id} />
                        <input type="hidden" name="movimientoId" value={mov.id} />
                        <button className="btn-secondary text-sm">Rechazar sugerencia</button>
                      </form>
                    )}
                    <Link href={cerrar} className="text-sm text-slate-500 underline">Volver</Link>
                  </div>
                )}

                {pdfUrl ? (
                  <DocViewer url={pdfUrl} mime={mov.archivoMime ?? 'application/pdf'} nombre={mov.archivoNombre ?? 'comprobante'} />
                ) : (
                  <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded p-4 text-center">
                    Este movimiento no tiene archivo adjunto (carga manual): compará con los datos de arriba.
                  </p>
                )}
              </div>
            </div>
          );
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/${params.empresaSlug}/resumenes`} className="text-sm text-slate-500 underline">← Resúmenes</Link>
        <h1 className="text-lg font-semibold">{resumen.emisor}</h1>
        <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold bg-line/60 text-ink-mute">
          {TIPO_LABEL[resumen.tipo]}
        </span>
        <span className="text-sm text-slate-500">{MES_LABEL[resumen.periodo.mes]} {resumen.periodo.anio}</span>
        {resumen.fechaCierre && (
          <span className="text-xs text-slate-400">Cierre {formatFecha(resumen.fechaCierre)}</span>
        )}
      </div>

      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="w-40 h-2 rounded bg-slate-200 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm text-slate-600 tabular-nums">{resueltas}/{total} resueltas</span>
          </div>
          <div className="flex items-center gap-2">
            {sugeridas > 0 && (
              <form action={confirmarSugeridasAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="resumenId" value={resumen.id} />
                <button className="btn-secondary text-sm">Confirmar todas las sugeridas ({sugeridas})</button>
              </form>
            )}
            <form action={rematchearAction}>
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <input type="hidden" name="resumenId" value={resumen.id} />
              <button className="btn-secondary text-sm">Re-matchear</button>
            </form>
            {reglasActivas > 0 && (
              <form action={aplicarReglasAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="resumenId" value={resumen.id} />
                <button className="btn-secondary text-sm" title="Ignora/imputa las líneas no resueltas según las reglas de resúmenes">
                  ⚡ Aplicar reglas ({reglasActivas})
                </button>
              </form>
            )}
          </div>
        </div>

        {resumen.totalDeclarado != null && diferencia != null && Math.abs(diferencia) > 1 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            El total declarado ({formatMoney(Number(resumen.totalDeclarado))}) difiere de la suma de las líneas
            ({formatMoney(sumaLineas)}) en {formatMoney(Math.abs(diferencia))}.
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm text-sky-700 underline">Ver el PDF del resumen</summary>
          <div className="mt-2">
            <DocViewer url={fileUrl} mime={resumen.archivoMime} nombre={resumen.archivoNombre} />
          </div>
        </details>
      </div>

      {panel}
      {popup}

      <div className="card divide-y divide-slate-100">
        {resumen.lineas.map((l) => {
          const candidatos = (l.candidatos as Candidato[] | null) ?? [];
          const top = l.estado === 'SUGERIDA' ? candidatos.find((c) => !c.rechazado) : undefined;
          const topMov = top ? movPorId.get(top.movimientoId) : null;
          return (
            <div key={l.id} className="py-2 px-3 flex flex-wrap items-start gap-3 hover:bg-slate-50">
              <div className="w-20 text-xs text-slate-500 pt-0.5 whitespace-nowrap">{formatFecha(l.fecha)}</div>
              <Link href={`${base}?linea=${l.id}`} className="flex-1 min-w-[220px]">
                <div className="text-sm">
                  {l.descriptor}
                  {l.cuotas && <span className="ml-1 text-xs text-slate-400">({l.cuotas})</span>}
                </div>
                {(l.cuenta || l.titular) && (
                  <div className="text-xs text-slate-400">{[l.cuenta, l.titular].filter(Boolean).join(' · ')}</div>
                )}
              </Link>
              <div
                className={`w-32 text-right tabular-nums text-sm pt-0.5 whitespace-nowrap ${
                  l.monto == null ? 'text-slate-500' : Number(l.monto) < 0 ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {l.monto != null
                  ? formatMoney(Number(l.monto))
                  : l.montoOrigen != null
                    ? `${l.moneda} ${Math.abs(Number(l.montoOrigen)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                    : '—'}
              </div>
              <div className="w-64">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${ESTADO_COLOR[l.estado]}`}>
                  {ESTADO_LABEL[l.estado]}
                </span>
                {l.reglaAplicada && (
                  <span className="ml-1 text-[11px] text-violet-700" title={`Resuelta automáticamente por la regla «${l.reglaAplicada}»`}>
                    ⚡ regla
                  </span>
                )}

                {l.estado === 'SUGERIDA' && top && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <Link
                      href={`${base}?linea=${l.id}&ver=${top.movimientoId}`}
                      className="text-amber-800 truncate underline decoration-amber-400 hover:decoration-amber-800"
                      title="Ver el comprobante propuesto"
                    >
                      → {topMov ? nombreContraparte(topMov).nombre ?? 'Sin identificar' : '—'} · {top.score}
                    </Link>
                    <form action={conciliarAction}>
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="resumenId" value={resumen.id} />
                      <input type="hidden" name="lineaId" value={l.id} />
                      <input type="hidden" name="movimientoId" value={top.movimientoId} />
                      <button className="btn-secondary !py-0.5 !px-2 text-xs">Conciliar</button>
                    </form>
                  </div>
                )}

                {(l.estado === 'CONCILIADA' || l.estado === 'IMPUTADA') && l.movimientoId && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <Link href={`/${params.empresaSlug}/validacion/${l.movimientoId}`} className="underline text-sky-700 truncate">
                      {l.movimiento ? nombreContraparte(l.movimiento).nombre ?? 'Ver movimiento' : 'Ver movimiento'}
                    </Link>
                    <form action={deshacerAction}>
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="resumenId" value={resumen.id} />
                      <input type="hidden" name="lineaId" value={l.id} />
                      <button className="text-slate-500 underline">deshacer</button>
                    </form>
                  </div>
                )}

                {l.estado === 'IGNORADA' && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="text-slate-500 truncate" title={l.motivoIgnorada ?? undefined}>{l.motivoIgnorada}</span>
                    <form action={deshacerAction}>
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="resumenId" value={resumen.id} />
                      <input type="hidden" name="lineaId" value={l.id} />
                      <button className="text-slate-500 underline">deshacer</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {resumen.lineas.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">Sin líneas.</p>}
      </div>
    </div>
  );
}
