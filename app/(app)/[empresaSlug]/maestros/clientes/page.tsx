import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarCliente, toggleCliente } from '../actions';

export default async function ClientesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const items = await ctx.db.cliente.findMany({ orderBy: { nombre: 'asc' } });
  const centros = await ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  const editando = searchParams.editar ? items.find((c) => c.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nuevo cliente'}</h2>
        <form action={guardarCliente} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div className="w-64">
            <label className="label">Nombre</label>
            <input name="nombre" required className="input" defaultValue={editando?.nombre} placeholder="Cliente Telecom" />
          </div>
          <div className="w-32">
            <label className="label">Código (opcional)</label>
            <input name="codigo" className="input" defaultValue={editando?.codigo ?? ''} />
          </div>
          <div className="w-56">
            <label className="label" title="Un cliente clasificado sólo aparece bajo su centro; sin clasificar aparece en todos">Centro de costo (árbol)</label>
            <select name="centroCostoId" className="input" defaultValue={editando?.centroCostoId ?? ''}>
              <option value="">— Sin clasificar —</option>
              {centros.map((cc) => (
                <option key={cc.id} value={cc.id}>{cc.nombre}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
          {editando && (
            <Link href={`/${params.empresaSlug}/maestros/clientes`} className="btn-secondary">Cancelar</Link>
          )}
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Código</th><th>Centro de costo</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                <td className="font-medium">{c.nombre}</td>
                <td>{c.codigo ?? '—'}</td>
                <td>{c.centroCostoId ? centros.find((cc) => cc.id === c.centroCostoId)?.nombre ?? '?' : '—'}</td>
                <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${c.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleCliente} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm underline text-slate-600">{c.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="text-center text-slate-400 py-6">Sin clientes todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
