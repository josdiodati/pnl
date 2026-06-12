import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarCentroCosto, toggleCentroCosto } from '../actions';

export default async function CentrosCostoPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const centros = await ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } });
  const editando = searchParams.editar ? centros.find((c) => c.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nuevo centro de costo'}</h2>
        <form action={guardarCentroCosto} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div className="w-56">
            <label className="label">Nombre</label>
            <input name="nombre" required className="input" defaultValue={editando?.nombre} placeholder="BPO" />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input" defaultValue={editando?.tipo ?? 'NEGOCIO'}>
              <option value="NEGOCIO">Negocio (genera ingresos)</option>
              <option value="SOPORTE">Soporte</option>
            </select>
          </div>
          <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
          {editando && (
            <Link href={`/${params.empresaSlug}/maestros/centros-costo`} className="btn-secondary">Cancelar</Link>
          )}
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {centros.map((c) => (
              <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                <td className="font-medium">{c.nombre}</td>
                <td>{c.tipo === 'NEGOCIO' ? 'Negocio' : 'Soporte'}</td>
                <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${c.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleCentroCosto} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm underline text-slate-600">{c.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {centros.length === 0 && (
              <tr><td colSpan={4} className="text-center text-slate-400 py-6">Sin centros de costo todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
