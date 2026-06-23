import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { getFileStorage } from '@/lib/storage';
import { DocViewer } from '@/components/doc-viewer';
import { ValidacionForm } from '@/components/validacion-form';
import { EstadoBadge, ArcaBadge, CanalBadge, QrBadge } from '@/components/badges';
import { ErrorBanner } from '@/components/error-banner';
import { formatFechaHora, formatMoney, fechaInputValue } from '@/lib/format';
import {
  observarAction,
  anularAction,
  volverAPendienteAction,
  reintentarAction,
  cargarAManoAction,
  reArcaAction,
} from '../actions';

const EDITABLES = new Set(['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO']);

export default async function ValidacionDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const mov = await ctx.db.movimiento.findFirst({
    where: { id: params.id },
    include: { contraparte: true, categoria: true, creadoPor: true, validadoPor: true },
  });
  if (!mov) notFound();

  const [contrapartes, historial] = await Promise.all([
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.auditLog.findMany({
      where: { entidad: 'Movimiento', entidadId: mov.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const fileUrl = mov.archivoKey ? await getFileStorage().getSignedUrl(mov.archivoKey) : null;
  const editable = EDITABLES.has(mov.estado);
  const flags = (mov.flags as Record<string, unknown> | null) ?? {};
  const n = (v: unknown) => (v == null ? null : Number(v));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/${params.empresaSlug}/validacion`} className="text-sm text-slate-500 underline">← Cola</Link>
        <h1 className="text-lg font-semibold">
          {mov.origen === 'COMPROBANTE' ? 'Comprobante' : mov.origen === 'ASIENTO_MANUAL' ? 'Asiento manual' : 'Venta manual'}
        </h1>
        <EstadoBadge estado={mov.estado} />
        {mov.cae && <ArcaBadge estado={mov.arcaEstado} />}
        <QrBadge estado={mov.qrEstado} />
        <CanalBadge canal={mov.canalIngreso} />
        {mov.estado === 'RETENIDO' && (
          <span className="text-xs text-orange-700">
            El período de la fecha del comprobante está cerrado: un administrador debe reabrirlo para poder validar.
          </span>
        )}
      </div>

      <ErrorBanner mensaje={searchParams.error} />

      {Boolean(flags.errorProcesamiento) && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          El procesamiento OCR falló: {String(flags.errorProcesamiento)}.
        </div>
      )}
      {Boolean(flags.notaObservacion) && mov.estado === 'OBSERVADO' && (
        <div className="rounded-md border border-purple-300 bg-purple-50 px-3 py-2 text-sm text-purple-800">
          Observado: {String(flags.notaObservacion)}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-3">
          {fileUrl ? (
            <DocViewer url={fileUrl} mime={mov.archivoMime ?? 'application/pdf'} nombre={mov.archivoNombre ?? 'documento'} />
          ) : (
            <div className="min-h-[40vh] flex items-center justify-center text-slate-400 text-sm">
              Sin documento adjunto
            </div>
          )}
          {mov.archivoHash && (
            <p className="mt-2 text-[10px] text-slate-400 break-all">SHA-256: {mov.archivoHash}</p>
          )}
        </div>

        <div className="card p-4">
          {editable ? (
            <ValidacionForm
              empresaSlug={params.empresaSlug}
              mov={{
                id: mov.id,
                estado: mov.estado,
                arcaEstado: mov.arcaEstado,
                arcaDetalle: mov.arcaDetalle,
                fechaDevengamiento: fechaInputValue(mov.fechaDevengamiento),
                tipoComprobante: mov.tipoComprobante ?? '',
                puntoVenta: mov.puntoVenta ?? '',
                numero: mov.numero ?? '',
                cuitEmisor: mov.cuitEmisor ?? '',
                contraparteId: mov.contraparteId ?? '',
                descripcion: mov.descripcion ?? '',
                moneda: mov.moneda,
                cae: mov.cae ?? '',
                importes: {
                  netoGravado: n(mov.netoGravado),
                  iva21: n(mov.iva21),
                  iva105: n(mov.iva105),
                  iva27: n(mov.iva27),
                  percepcionesIva: n(mov.percepcionesIva),
                  percepcionesIibb: n(mov.percepcionesIibb),
                  otrosTributos: n(mov.otrosTributos),
                  noGravadoExento: n(mov.noGravadoExento),
                  total: n(mov.total),
                },
                camposRevisar: (mov.camposRevisar as Record<string, string> | null) ?? {},
                duplicados: ((flags.duplicados as string[] | undefined) ?? []),
              }}
              contrapartes={contrapartes.map((c) => ({
                id: c.id,
                razonSocial: c.razonSocial,
                cuit: c.cuit,
                categoriaDefaultId: c.categoriaDefaultId,
                instruccionesExtraccion: c.instruccionesExtraccion,
              }))}
            />
          ) : (
            <div className="space-y-2 text-sm">
              <h2 className="font-medium">Resumen</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-slate-500">Contraparte</dt>
                <dd>{mov.contraparte?.razonSocial ?? '—'}</dd>
                <dt className="text-slate-500">Categoría</dt>
                <dd>{mov.categoria?.nombre ?? '—'}</dd>
                <dt className="text-slate-500">Comprobante</dt>
                <dd>{mov.tipoComprobante?.replace(/_/g, ' ') ?? '—'} {mov.puntoVenta ? `${mov.puntoVenta}-` : ''}{mov.numero ?? ''}</dd>
                <dt className="text-slate-500">Total</dt>
                <dd className="tabular-nums">{formatMoney(n(mov.total))}</dd>
                {(mov.estado === 'VALIDADO' || mov.estado === 'ASIGNADO') && (
                  <>
                    <dt className="text-slate-500">Validado por</dt>
                    <dd>{mov.validadoPor?.nombre ?? 'Automático (sistema)'}</dd>
                  </>
                )}
                {mov.motivoAnulacion && (
                  <>
                    <dt className="text-slate-500">Motivo de anulación</dt>
                    <dd className="text-red-700">{mov.motivoAnulacion}</dd>
                  </>
                )}
              </dl>
              {mov.estado === 'PROCESANDO' || mov.estado === 'INGRESADO' ? (
                <p className="text-slate-500">
                  Este movimiento está en el pipeline; cuando termine el OCR va a aparecer en la cola.
                </p>
              ) : null}
            </div>
          )}

          {/* Secondary actions (separate forms, outside the main one) */}
          <div className="mt-4 border-t border-slate-100 pt-3 flex flex-wrap items-end gap-2">
            {(mov.estado === 'PENDIENTE_VALIDACION' || mov.estado === 'RETENIDO') && (
              <form action={observarAction} className="flex items-end gap-2">
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                <div>
                  <label className="label">Nota (opcional)</label>
                  <input name="nota" className="input !w-48" placeholder="Por qué se aparta" />
                </div>
                <button className="btn-secondary">Observar</button>
              </form>
            )}
            {mov.estado === 'OBSERVADO' && (
              <form action={volverAPendienteAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                <button className="btn-secondary">Volver a pendiente</button>
              </form>
            )}
            {mov.estado === 'ERROR_PROCESAMIENTO' && (
              <>
                <form action={reintentarAction}>
                  <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                  <input type="hidden" name="movimientoId" value={mov.id} />
                  <button className="btn-secondary">Reintentar extracción</button>
                </form>
                <form action={cargarAManoAction}>
                  <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                  <input type="hidden" name="movimientoId" value={mov.id} />
                  <button className="btn-secondary">Cargar a mano</button>
                </form>
              </>
            )}
            {mov.cae && mov.estado !== 'ANULADO' && (
              <form action={reArcaAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                <button className="btn-secondary">Re-consultar ARCA</button>
              </form>
            )}
            {['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'VALIDADO'].includes(mov.estado) && (
              <form action={anularAction} className="flex items-end gap-2 ml-auto">
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                <div>
                  <label className="label">Motivo de anulación</label>
                  <input name="motivo" required className="input !w-48" placeholder="Obligatorio" />
                </div>
                <button className="btn-danger">Anular</button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* History panel (doc 08): full trace from upload to validation */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-600 mb-2">Historial</h2>
        <ol className="space-y-1 text-sm">
          <li className="text-slate-600">
            <span className="text-slate-400">{formatFechaHora(mov.createdAt)}</span> — Cargado por{' '}
            <strong>{mov.creadoPor.nombre}</strong> vía {mov.canalIngreso ?? '—'}
          </li>
          {historial.map((h) => (
            <li key={h.id} className="text-slate-600">
              <span className="text-slate-400">{formatFechaHora(h.createdAt)}</span> — {h.accion}
              {h.despues != null && (
                <span className="text-slate-400 text-xs ml-1 break-all">
                  {JSON.stringify(h.despues).slice(0, 180)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
