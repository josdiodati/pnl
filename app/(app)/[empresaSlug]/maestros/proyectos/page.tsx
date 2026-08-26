import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarProyecto, toggleProyecto } from '../actions';

export default async function ProyectosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const items = await ctx.db.proyecto.findMany({ orderBy: { nombre: 'asc' } });
  const clientes = await ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  const editando = searchParams.editar ? items.find((p) => p.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nuevo proyecto'}</h2>
        <form action={guardarProyecto} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div className="w-64">
            <label className="label">Nombre</label>
            <input name="nombre" required className="input" defaultValue={editando?.nombre} placeholder="Proyecto MicroIT" />
          </div>
          <div className="w-32">
            <label className="label">Código (opcional)</label>
            <input name="codigo" className="input" defaultValue={editando?.codigo ?? ''} />
          </div>
          <div className="w-56">
            <label className="label" title="Un proyecto clasificado sólo aparece bajo su cliente; sin clasificar aparece en todos">Cliente (árbol)</label>
            <select name="clienteId" className="input" defaultValue={editando?.clienteId ?? ''}>
              <option value="">— Sin clasificar —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
          {editando && (
            <Link href={`/${params.empresaSlug}/maestros/proyectos`} className="btn-secondary">Cancelar</Link>
          )}
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Código</th><th>Cliente</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={!p.activo ? 'opacity-50' : ''}>
                <td className="font-medium">{p.nombre}</td>
                <td>{p.codigo ?? '—'}</td>
                <td>{p.clienteId ? clientes.find((c) => c.id === p.clienteId)?.nombre ?? '?' : '—'}</td>
                <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${p.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleProyecto} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-sm underline text-slate-600">{p.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="text-center text-slate-400 py-6">Sin proyectos todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
