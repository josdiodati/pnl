import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { getFileStorage } from '@/lib/storage';
import { DocViewer } from '@/components/doc-viewer';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { ErrorBanner } from '@/components/error-banner';
import { formatMoney, formatFecha } from '@/lib/format';
import { totalFirmadoDe } from '@/lib/movimientos/query';
import { asignarAction } from '../actions';

export default async function AsignacionDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');

  const mov = await ctx.db.movimiento.findFirst({
    where: { id: params.id },
    include: { contraparte: true, categoria: true, lineas: true },
  });
  if (!mov) notFound();
  if (mov.estado !== 'VALIDADO' && mov.estado !== 'ASIGNADO') notFound();

  const [categorias, centros, clientes, proyectos, plantillas, fileUrl] = await Promise.all([
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ include: { lineas: true }, orderBy: { nombre: 'asc' } }),
    mov.archivoKey ? getFileStorage().getSignedUrl(mov.archivoKey) : Promise.resolve(null),
  ]);

  const tfCents = totalFirmadoDe(mov as never);
  const totalFirmado = tfCents != null ? tfCents / 100 : null;

  const inicial =
    mov.lineas.length > 0
      ? mov.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId ?? '',
          proyectoId: l.proyectoId ?? '',
          porcentaje: String(Number(l.porcentaje)),
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
                defaultValue={mov.categoriaId ?? ''}
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
              clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
              proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre }))}
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

            <div className="flex gap-2 pt-2">
              <button type="submit" name="siguiente" value="1" className="btn-secondary">
                Asignar y siguiente
              </button>
              <button type="submit" className="btn-primary">
                Asignar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
