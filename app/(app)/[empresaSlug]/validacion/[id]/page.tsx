import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { prisma } from '@/lib/db';
import { getFileStorage } from '@/lib/storage';
import { DocViewer } from '@/components/doc-viewer';
import { ValidacionForm } from '@/components/validacion-form';
import { ComprobanteDetalle } from '@/components/comprobante-detalle';
import { HistorialComprobante } from '@/components/historial-comprobante';
import { EstadoBadge, ArcaBadge, CanalBadge, QrBadge } from '@/components/badges';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { fechaInputValue } from '@/lib/format';
import { MES_LABEL } from '@/lib/periodos';
import { elegirRegla, textoDeMatching, textoDocumentoDe } from '@/lib/reglas/matching';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { reglasDelCuit, describirCondiciones } from '@/lib/reglas/desde-asignacion';
import { ocrParaRegla } from '@/lib/reglas/ocr-para-regla';
import { nombreContraparte, cuitContraparteDe, esVenta } from '@/lib/movimientos/nombre-contraparte';
import {
  observarAction,
  anularAction,
  volverAPendienteAction,
  reintentarAction,
  cargarAManoAction,
  reArcaAction,
  eliminarDuplicadoAction,
} from '../actions';
import { originalDeDuplicado } from '@/lib/movimientos/service';
import { rolAlcanza } from '@/lib/roles';

const EDITABLES = new Set(['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO']);
// Estados desde los que se puede devolver el comprobante a la cola de Validación.
// RETENIDO tenía la transición permitida desde siempre pero se había quedado sin botón.
const VUELVEN_A_PENDIENTE = new Set(['OBSERVADO', 'DUPLICADO', 'RETENIDO', 'VALIDADO', 'ASIGNADO']);

export default async function ValidacionDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const mov = await ctx.db.movimiento.findFirst({
    where: { id: params.id },
    include: {
      contraparte: true,
      categoria: true,
      lineas: true,
      creadoPor: true,
      validadoPor: true,
      vinculosResumen: {
        include: { linea: { include: { resumen: { include: { periodo: true } } } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!mov) notFound();
  // Un comprobante puede pagarse en varias líneas (pago parcial): se listan todas.
  const lineasResumen = mov.vinculosResumen.map((v) => v.linea);

  const [contrapartes, categorias, centros, clientes, proyectos, plantillas, reglas, miembros] = await Promise.all([
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ include: { lineas: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] }),
    prisma.usuarioEmpresa.findMany({ where: { empresaId: ctx.empresa.id }, include: { usuario: { select: { id: true, nombre: true, email: true } } }, orderBy: { usuario: { nombre: 'asc' } } }),
  ]);
  const miembrosRegla = miembros.map((m) => ({ id: m.usuario.id, nombre: m.usuario.nombre || m.usuario.email }));
  const fileUrl = mov.archivoKey ? await getFileStorage().getSignedUrl(mov.archivoKey) : null;
  const editable = EDITABLES.has(mov.estado);
  const flags = (mov.flags as Record<string, unknown> | null) ?? {};
  const n = (v: unknown) => (v == null ? null : Number(v));

  // Reglas ya vigentes para este CUIT (puede haber varias): se listan para que
  // el validador sepa cuál se pisa y cuál se crea aparte. Sin consulta extra.
  const reglasVigentes = reglasDelCuit(reglas, cuitContraparteDe(mov));
  const nombresUsuarios = new Map(miembrosRegla.map((m) => [m.id, m.nombre]));
  const imputacionDeRegla = (r: (typeof reglasVigentes)[number]) => {
    const cat = categorias.find((c) => c.id === r.categoriaId)?.nombre ?? 'sin categoría';
    const dist = r.distribucionId
      ? (plantillas.find((p) => p.id === r.distribucionId)?.nombre ?? 'plantilla')
      : r.centroCostoId
        ? (centros.find((c) => c.id === r.centroCostoId)?.nombre ?? '?')
        : 'sin distribución';
    return `${cat} / ${dist}`;
  };

  // Pre-imputación: si el comprobante no tiene líneas, una regla puede pre-llenar
  // la asignación para que el validador la confirme en la misma pantalla.
  let reglaSugerida: string | null = null;
  let sugerida: Awaited<ReturnType<typeof resolverAsignacionDeRegla>> | null = null;
  if (editable && mov.lineas.length === 0) {
    const raw = mov.extraccionRaw as { razonSocialEmisor?: string; razonSocialReceptor?: string } | null;
    const razonSocial = (esVenta(mov.origen) ? raw?.razonSocialReceptor : raw?.razonSocialEmisor) ?? '';
    const regla = elegirRegla(reglas, {
      creadoPorId: mov.creadoPorId,
      cuitContraparte: cuitContraparteDe(mov),
      canalIngreso: mov.canalIngreso,
      texto: textoDeMatching({ razonSocial, descripcion: mov.descripcion, textoDocumento: textoDocumentoDe(mov.extraccionRaw) }),
    });
    if (regla) {
      sugerida = await resolverAsignacionDeRegla(ctx.db, regla);
      reglaSugerida = regla.nombre;
    }
  }
  const lineasIniciales =
    mov.lineas.length > 0
      ? mov.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId ?? '',
          proyectoId: l.proyectoId ?? '',
          porcentaje: String(Number(l.porcentaje)),
        }))
      : sugerida && sugerida.lineas.length > 0
        ? sugerida.lineas.map((l) => ({
            centroCostoId: l.centroCostoId,
            clienteId: l.clienteId ?? '',
            proyectoId: l.proyectoId ?? '',
            porcentaje: String(l.porcentaje),
          }))
        : [];
  const categoriaInicial = mov.categoriaId ?? sugerida?.categoriaId ?? '';

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
        {Boolean(flags.reglaPreasignacion) && (
          <span
            title={`Pre-asignado por la regla «${String(flags.reglaPreasignacion)}». La imputación ya viene cargada; al validar, si está completa pasará directo a Asignado.`}
            className="cursor-help rounded bg-sky-100 text-sky-800 px-1.5 py-0.5 text-[11px] font-semibold"
          >
            ⚡ regla
          </span>
        )}
        {mov.estado === 'RETENIDO' && (
          <span className="text-xs text-orange-700">
            El período de la fecha del comprobante está cerrado: un administrador debe reabrirlo para poder validar.
          </span>
        )}
      </div>

      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      {lineasResumen.length > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 space-y-1">
          {lineasResumen.length > 1 && (
            <p className="font-medium">Pagado en {lineasResumen.length} movimientos de resumen:</p>
          )}
          {lineasResumen.map((lineaResumen) => (
            <p key={lineaResumen.id}>
              Conciliado con la línea &quot;{lineaResumen.descriptor}&quot; del resumen {lineaResumen.resumen.emisor} (
              {MES_LABEL[lineaResumen.resumen.periodo.mes]} {lineaResumen.resumen.periodo.anio}) —{' '}
              <Link href={`/${params.empresaSlug}/resumenes/${lineaResumen.resumenId}?linea=${lineaResumen.id}`} className="underline">
                ver en la bandeja
              </Link>
            </p>
          ))}
        </div>
      )}
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
      {mov.estado === 'DUPLICADO' && (
        <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 space-y-2">
          {flags.duplicadoArchivo ? (
            <>
              <strong>Archivo duplicado</strong>: es exactamente el mismo archivo (mismo hash) que otro comprobante ya
              ingresado, así que no se procesó. Si igual corresponde procesarlo, usá «No es duplicado: volver a
              pendiente» y se re-encola la extracción.
            </>
          ) : (
            <>
              Detectado como <strong>duplicado</strong> (mismo CUIT + tipo + punto de venta + número que otro
              comprobante), confirmado por QR/ARCA. Si en realidad no es un duplicado, usá «No es duplicado: volver a
              pendiente».
            </>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {originalDeDuplicado(mov.flags) && (
              <Link href={`/${params.empresaSlug}/validacion/${originalDeDuplicado(mov.flags)}`} className="btn-primary text-xs">
                Ver el comprobante original →
              </Link>
            )}
            {rolAlcanza(ctx.rol, 'ADMINISTRADOR') && (
              <form action={eliminarDuplicadoAction}>
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                <button className="btn-danger text-xs" title="Borra físicamente este duplicado; el original queda intacto">
                  Borrar duplicado
                </button>
              </form>
            )}
          </div>
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
                cuitReceptor: String((mov.extraccionRaw as { cuitReceptorEfectivo?: string } | null)?.cuitReceptorEfectivo ?? ''),
                esVenta: mov.origen === 'VENTA_COMPROBANTE' || mov.origen === 'VENTA_MANUAL',
                contraparteId: mov.contraparteId ?? '',
                descripcion: mov.descripcion ?? '',
                moneda: mov.moneda,
                tipoCambio: mov.tipoCambio != null ? String(Number(mov.tipoCambio)) : '',
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
                categoriaId: categoriaInicial,
                lineas: lineasIniciales,
              }}
              reglaSugerida={reglaSugerida}
              ocrRegla={ocrParaRegla({ extraccionRaw: mov.extraccionRaw, descripcion: mov.descripcion, razonSocialContraparte: nombreContraparte(mov).nombre })}
              reglaContexto={{ canal: mov.canalIngreso, cargadoPorId: mov.creadoPorId, miembros: miembrosRegla }}
              categorias={categorias.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, padreId: c.padreId }))}
              centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
              clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre, centroCostoId: c.centroCostoId }))}
              proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, clienteId: p.clienteId }))}
              plantillas={plantillas.map((p) => ({
                id: p.id,
                nombre: p.nombre,
                lineas: p.lineas.map((l) => ({
                  centroCostoId: l.centroCostoId,
                  clienteId: l.clienteId ?? null,
                  proyectoId: l.proyectoId ?? null,
                  porcentaje: Number(l.porcentaje),
                })),
              }))}
              contrapartes={contrapartes.map((c) => ({
                id: c.id,
                razonSocial: c.razonSocial,
                cuit: c.cuit,
                categoriaDefaultId: c.categoriaDefaultId,
                instruccionesExtraccion: c.instruccionesExtraccion,
              }))}
              razonSocialContraparte={nombreContraparte(mov).nombre}
              reglasVigentes={reglasVigentes.map((r) => ({ nombre: r.nombre, condiciones: describirCondiciones(r, nombresUsuarios), imputacion: imputacionDeRegla(r) }))}
            />
          ) : (
            <div className="space-y-3">
              {mov.estado === 'PROCESANDO' || mov.estado === 'INGRESADO' ? (
                <p className="text-sm text-slate-500">
                  Este movimiento está en el pipeline; cuando termine el OCR va a aparecer en la cola.
                </p>
              ) : (
                <ComprobanteDetalle
                  mov={mov as never}
                  centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
                  clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre, centroCostoId: c.centroCostoId }))}
                  proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, clienteId: p.clienteId }))}
                />
              )}
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
            {VUELVEN_A_PENDIENTE.has(mov.estado) && (
              <form action={volverAPendienteAction} className="flex items-end gap-2">
                <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                <input type="hidden" name="movimientoId" value={mov.id} />
                {(mov.estado === 'VALIDADO' || mov.estado === 'ASIGNADO') && (
                  <div>
                    <label className="label">Nota (opcional)</label>
                    <input name="nota" className="input !w-48" placeholder="Por qué se reabre" />
                  </div>
                )}
                <button className="btn-secondary">
                  {mov.estado === 'DUPLICADO'
                    ? 'No es duplicado: volver a pendiente'
                    : mov.estado === 'VALIDADO' || mov.estado === 'ASIGNADO'
                      ? 'Devolver a revisión'
                      : 'Volver a pendiente'}
                </button>
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
                <button className="btn-secondary" title="Vuelve a cruzar este comprobante con lo ya bajado de Mis Comprobantes">Cruzar con Mis Comprobantes</button>
              </form>
            )}
            {['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'VALIDADO', 'DUPLICADO'].includes(mov.estado) && (
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

      {/* Historial (doc 08): traza completa desde la carga, común a todas las vistas de detalle */}
      <HistorialComprobante
        db={ctx.db}
        empresaId={ctx.empresa.id}
        mov={{ id: mov.id, createdAt: mov.createdAt, canalIngreso: mov.canalIngreso, creadoPorId: mov.creadoPorId }}
      />
    </div>
  );
}
