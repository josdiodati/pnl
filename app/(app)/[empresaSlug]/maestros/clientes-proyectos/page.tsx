import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarClienteProyecto, toggleClienteProyecto } from '../actions';

export default async function ClientesProyectosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  // NOTA: la 2ª dimensión (clientes/proyectos) está deshabilitada del menú (ver el link comentado
  // en app/(app)/[empresaSlug]/layout.tsx). Esta página queda funcional pero no enlazada; se reactiva
  // descomentando el link. Los clientes se manejan por ahora vía Contrapartes.
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const items = await ctx.db.cliente.findMany({ orderBy: { nombre: 'asc' } });
  const editando = searchParams.editar ? items.find((c) => c.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />
      <p className="text-sm text-slate-500">
        Segunda dimensión de análisis: cada línea de asignación puede (opcionalmente) imputarse a un cliente o proyecto.
      </p>

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.nombre}"` : 'Nuevo cliente / proyecto'}</h2>
        <form action={guardarClienteProyecto} className="flex flex-wrap items-end gap-3">
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
          <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
          {editando && (
            <Link href={`/${params.empresaSlug}/maestros/clientes-proyectos`} className="btn-secondary">Cancelar</Link>
          )}
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Nombre</th><th>Código</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                <td className="font-medium">{c.nombre}</td>
                <td>{c.codigo ?? '—'}</td>
                <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${c.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleClienteProyecto} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm underline text-slate-600">{c.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={4} className="text-center text-slate-400 py-6">Sin clientes/proyectos todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
