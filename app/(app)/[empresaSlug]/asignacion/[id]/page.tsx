import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { getFileStorage } from '@/lib/storage';
import { DocViewer } from '@/components/doc-viewer';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { ReglaDesdeAsignacion } from '@/components/regla-desde-asignacion';
import { buscarReglaPorCuit } from '@/lib/reglas/guardar-desde-asignacion';
import { nombreContraparte, cuitContraparteDe, esVenta } from '@/lib/movimientos/nombre-contraparte';
import { formatMoney, formatFecha } from '@/lib/format';
import { totalFirmadoDe } from '@/lib/movimientos/query';
import { elegirRegla } from '@/lib/reglas/matching';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { ocrParaRegla } from '@/lib/reglas/ocr-para-regla';
import { asignarAction } from '../actions';
import { volverAPendienteAction } from '../../validacion/actions';

export default async function AsignacionDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');

  const mov = await ctx.db.movimiento.findFirst({
    where: { id: params.id },
    include: { contraparte: true, categoria: true, lineas: true },
  });
  if (!mov) notFound();
  if (mov.estado !== 'VALIDADO' && mov.estado !== 'ASIGNADO') notFound();

  const [categorias, centros, clientes, proyectos, plantillas, reglas, fileUrl] = await Promise.all([
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ include: { lineas: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] }),
    mov.archivoKey ? getFileStorage().getSignedUrl(mov.archivoKey) : Promise.resolve(null),
  ]);

  const tfCents = totalFirmadoDe(mov as never);
  const totalFirmado = tfCents != null ? tfCents / 100 : null;

  // Si el movimiento llega sin líneas, una regla de preasignación puede pre-llenar
  // la asignación (categoría + líneas). Es sólo un default editable.
  let reglaAplicada: string | null = null;
  let sugerida: Awaited<ReturnType<typeof resolverAsignacionDeRegla>> | null = null;
  if (mov.lineas.length === 0) {
    const raw = mov.extraccionRaw as { razonSocialEmisor?: string; razonSocialReceptor?: string } | null;
    const razonSocial = (esVenta(mov.origen) ? raw?.razonSocialReceptor : raw?.razonSocialEmisor) ?? '';
    const regla = elegirRegla(reglas, {
      creadoPorId: mov.creadoPorId,
      cuitContraparte: cuitContraparteDe(mov),
      canalIngreso: mov.canalIngreso,
      texto: `${razonSocial} ${mov.descripcion ?? ''}`,
    });
    if (regla) {
      sugerida = await resolverAsignacionDeRegla(ctx.db, regla);
      reglaAplicada = regla.nombre;
    }
  }

  // Regla ya vigente para este CUIT: se resuelve al renderizar (depende sólo del
  // CUIT), así el conflicto se decide en el mismo submit que la asignación.
  const reglaVigente = await buscarReglaPorCuit(ctx, mov.cuitEmisor);
  const imputacionDe = (r: NonNullable<typeof reglaVigente>) => {
    const cat = categorias.find((c) => c.id === r.categoriaId)?.nombre ?? 'sin categoría';
    const dist = r.distribucionId
      ? (plantillas.find((p) => p.id === r.distribucionId)?.nombre ?? 'plantilla')
      : r.centroCostoId
        ? (centros.find((c) => c.id === r.centroCostoId)?.nombre ?? '?')
        : 'sin distribución';
    return `${cat} / ${dist}`;
  };

  const inicial =
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
        : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/${params.empresaSlug}/asignacion`} className="text-sm text-slate-500 underline">
          ← Cola de Asignación
        </Link>
        <h1 className="text-lg font-semibold">Asignar comprobante</h1>
      </div>

      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      {reglaAplicada && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Pre-llenado por la regla «{reglaAplicada}» — revisá antes de asignar.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Doc viewer */}
        <div className="card p-3">
          {fileUrl ? (
            <DocViewer url={fileUrl} mime={mov.archivoMime ?? 'application/pdf'} nombre={mov.archivoNombre ?? 'documento'} />
          ) : (
            <div className="min-h-[40vh] flex items-center justify-center text-slate-400 text-sm">
              Sin documento adjunto
            </div>
          )}
        </div>

        {/* Assignment form */}
        <div className="card p-4 space-y-4">
          {/* Summary */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Contraparte</dt>
            <dd>{mov.contraparte?.razonSocial ?? '—'}</dd>
            <dt className="text-slate-500">Comprobante</dt>
            <dd>
              {mov.tipoComprobante?.replace(/_/g, ' ') ?? '—'}{' '}
              {mov.puntoVenta ? `${mov.puntoVenta}-` : ''}{mov.numero ?? ''}
            </dd>
            <dt className="text-slate-500">Fecha</dt>
            <dd>{formatFecha(mov.fechaDevengamiento)}</dd>
            <dt className="text-slate-500">Total</dt>
            <dd className="tabular-nums font-medium">{formatMoney(mov.total ? Number(mov.total) : null)}</dd>
          </dl>

          <form action={asignarAction} className="space-y-4">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="movimientoId" value={mov.id} />

            {/* Categoría */}
            <div>
              <label className="label" htmlFor="categoriaId">Categoría</label>
              <select
                id="categoriaId"
                name="categoriaId"
                required
                defaultValue={mov.categoriaId ?? sugerida?.categoriaId ?? ''}
                className="input w-full"
              >
                <option value="" disabled>Seleccioná una categoría…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.padreId ? '· ' : ''}{c.nombre} ({c.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'})
                  </option>
                ))}
              </select>
            </div>

            {/* Distribution editor */}
            <DistribucionEditor
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
              inicial={inicial}
              totalFirmado={totalFirmado}
            />

            <ReglaDesdeAsignacion
              cuit={mov.cuitEmisor}
              razonSocial={nombreContraparte(mov).nombre}
              existente={reglaVigente ? { nombre: reglaVigente.nombre, imputacion: imputacionDe(reglaVigente) } : null}
              ocr={ocrParaRegla({ extraccionRaw: mov.extraccionRaw, descripcion: mov.descripcion, razonSocialContraparte: nombreContraparte(mov).nombre })}
            />

            <div className="flex gap-2 pt-2">
              <button type="submit" name="siguiente" value="1" className="btn-secondary">
                Asignar y siguiente
              </button>
              <button type="submit" className="btn-primary">
                Asignar
              </button>
            </div>
          </form>

          {/* Fuera del form de asignación: devuelve el comprobante a la cola de
              Validación para corregirlo (exige período abierto). */}
          <form action={volverAPendienteAction} className="border-t border-slate-100 pt-3 flex items-end gap-2">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="movimientoId" value={mov.id} />
            <div>
              <label className="label">Nota (opcional)</label>
              <input name="nota" className="input !w-48" placeholder="Por qué se reabre" />
            </div>
            <button className="btn-secondary">Devolver a revisión</button>
          </form>
        </div>
      </div>
    </div>
  );
}
