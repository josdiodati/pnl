import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarCategoria, toggleCategoria } from '../actions';

export default async function CategoriasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const categorias = await ctx.db.categoria.findMany({
    orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
  });
  const padres = categorias.filter((c) => !c.padreId);
  const editando = searchParams.editar ? categorias.find((c) => c.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nueva categoría'}</h2>
        <form action={guardarCategoria} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div className="w-56">
            <label className="label">Nombre</label>
            <input name="nombre" required className="input" defaultValue={editando?.nombre} />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input" defaultValue={editando?.tipo ?? 'EGRESO'}>
              <option value="EGRESO">Egreso</option>
              <option value="INGRESO">Ingreso</option>
            </select>
          </div>
          <div className="w-56">
            <label className="label">Categoría padre (opcional)</label>
            <select name="padreId" className="input" defaultValue={editando?.padreId ?? ''}>
              <option value="">— Nivel superior —</option>
              {padres.filter((p) => p.id !== editando?.id).map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>
              ))}
            </select>
          </div>
          <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
          {editando && (
            <Link href={`/${params.empresaSlug}/maestros/categorias`} className="btn-secondary">Cancelar</Link>
          )}
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Padre</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.id} className={!c.activa ? 'opacity-50' : ''}>
                <td className={c.padreId ? 'pl-8' : 'font-medium'}>{c.nombre}</td>
                <td>{c.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}</td>
                <td>{c.padreId ? categorias.find((p) => p.id === c.padreId)?.nombre : '—'}</td>
                <td>{c.activa ? 'Activa' : 'Inactiva'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${c.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleCategoria} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm underline text-slate-600">{c.activa ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {categorias.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">Sin categorías todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
