import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { guardarPlantillaDistribucion } from '../actions';

export default async function DistribucionesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const [plantillas, centros, clientes] = await Promise.all([
    ctx.db.plantillaDistribucion.findMany({ include: { lineas: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.clienteProyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
  ]);
  const editando = searchParams.editar ? plantillas.find((p) => p.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />
      <p className="text-sm text-slate-500">
        Plantillas reutilizables, p. ej. &quot;Alquiler oficina → 60% BPO / 30% SF / 10% Administración&quot;. Se aplican con
        un click en cualquier movimiento y pueden ser el default de una contraparte.
      </p>

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nueva plantilla'}</h2>
        <form action={guardarPlantillaDistribucion} className="space-y-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div className="w-72">
            <label className="label">Nombre</label>
            <input name="nombre" required className="input" defaultValue={editando?.nombre} placeholder="Alquiler 60/30/10" />
          </div>
          <DistribucionEditor
            key={editando?.id ?? 'nueva'}
            centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
            clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
            inicial={editando?.lineas.map((l) => ({
              centroCostoId: l.centroCostoId,
              clienteProyectoId: l.clienteProyectoId ?? '',
              porcentaje: String(Number(l.porcentaje)),
            }))}
          />
          <div className="flex gap-2">
            <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear plantilla'}</button>
            {editando && (
              <Link href={`/${params.empresaSlug}/maestros/distribuciones`} className="btn-secondary">Cancelar</Link>
            )}
          </div>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Líneas</th><th></th></tr>
          </thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.nombre}</td>
                <td>
                  {p.lineas.map((l, i) => (
                    <span key={l.id} className="text-sm text-slate-600">
                      {i > 0 && ' · '}
                      {centros.find((c) => c.id === l.centroCostoId)?.nombre ?? '?'}
                      {l.clienteProyectoId ? ` / ${clientes.find((c) => c.id === l.clienteProyectoId)?.nombre ?? '?'}` : ''}{' '}
                      {Number(l.porcentaje).toLocaleString('es-AR')}%
                    </span>
                  ))}
                </td>
                <td className="text-right">
                  <Link href={`?editar=${p.id}`} className="text-sm underline text-slate-600">Editar</Link>
                </td>
              </tr>
            ))}
            {plantillas.length === 0 && (
              <tr><td colSpan={3} className="text-center text-slate-400 py-6">Sin plantillas todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
