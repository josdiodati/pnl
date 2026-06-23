import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarRegla, toggleRegla } from '../actions';

export default async function ReglasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const [reglas, miembros, categorias, plantillas, centros, clientes, proyectos, contrapartes] =
    await Promise.all([
      ctx.db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }, { nombre: 'asc' }] }),
      ctx.db.usuarioEmpresa.findMany({
        where: { empresaId: ctx.empresa.id },
        include: { usuario: true },
      }),
      ctx.db.categoria.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } }),
      ctx.db.plantillaDistribucion.findMany({ orderBy: { nombre: 'asc' } }),
      ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
      ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
    ]);

  const editando = searchParams.editar ? reglas.find((r) => r.id === searchParams.editar) : null;

  const cuitPlaceholder = contrapartes
    .slice(0, 3)
    .map((c) => c.cuit)
    .join(', ');

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">
          {editando ? `Editar "${editando.nombre}"` : 'Nueva regla'}
        </h2>
        <form action={guardarRegla} className="space-y-4">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}

          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-48">
              <label className="label">Nombre</label>
              <input
                name="nombre"
                required
                className="input"
                defaultValue={editando?.nombre}
                placeholder="Alquiler oficina"
              />
            </div>
            <div className="w-28">
              <label className="label">Prioridad</label>
              <input
                name="prioridad"
                type="number"
                className="input"
                defaultValue={editando?.prioridad ?? 100}
              />
            </div>
          </div>

          <fieldset className="border border-slate-200 rounded p-3 space-y-3">
            <legend className="text-sm font-medium text-slate-600 px-1">
              Condiciones: se aplican en conjunto (Y). Dejá vacío lo que no aplique.
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Cargado por</label>
                <select name="cargadoPorId" className="input" defaultValue={editando?.cargadoPorId ?? ''}>
                  <option value="">— cualquiera —</option>
                  {miembros.map((m) => (
                    <option
                      key={m.usuarioId}
                      value={m.usuarioId}
                    >
                      {m.usuario.nombre || m.usuario.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">CUIT</label>
                <input
                  name="cuit"
                  className="input"
                  defaultValue={editando?.cuit ?? ''}
                  placeholder={cuitPlaceholder || '20-12345678-9'}
                />
              </div>
              <div>
                <label className="label">Canal</label>
                <select name="canal" className="input" defaultValue={editando?.canal ?? ''}>
                  <option value="">— cualquiera —</option>
                  {['WEB', 'FOTO', 'EMAIL', 'TELEGRAM', 'MANUAL'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Palabra clave</label>
                <input
                  name="palabraClave"
                  className="input"
                  defaultValue={editando?.palabraClave ?? ''}
                  placeholder="alquiler"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="border border-slate-200 rounded p-3 space-y-3">
            <legend className="text-sm font-medium text-slate-600 px-1">
              Acción: elegí categoría y una plantilla de distribución, o un centro de costo (línea
              única 100%).
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Categoría</label>
                <select name="categoriaId" className="input" defaultValue={editando?.categoriaId ?? ''}>
                  <option value="">— elegir —</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Plantilla de distribución</label>
                <select name="distribucionId" className="input" defaultValue={editando?.distribucionId ?? ''}>
                  <option value="">— ninguna —</option>
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Centro de costo (100%)</label>
                <select name="centroCostoId" className="input" defaultValue={editando?.centroCostoId ?? ''}>
                  <option value="">— ninguno —</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Cliente</label>
                <select name="clienteId" className="input" defaultValue={editando?.clienteId ?? ''}>
                  <option value="">— ninguno —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Proyecto</label>
                <select name="proyectoId" className="input" defaultValue={editando?.proyectoId ?? ''}>
                  <option value="">— ninguno —</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <div className="flex gap-2">
            <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear regla'}</button>
            {editando && (
              <Link href={`/${params.empresaSlug}/maestros/reglas`} className="btn-secondary">
                Cancelar
              </Link>
            )}
          </div>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Prioridad</th>
              <th>Nombre</th>
              <th>Condiciones</th>
              <th>Acción</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reglas.map((r) => {
              const condParts: string[] = [];
              if (r.cargadoPorId) {
                const m = miembros.find((mb) => mb.usuarioId === r.cargadoPorId);
                if (m) condParts.push(m.usuario.nombre || m.usuario.email);
              }
              if (r.cuit) condParts.push(r.cuit);
              if (r.canal) condParts.push(r.canal);
              if (r.palabraClave) condParts.push(r.palabraClave);

              const cat = r.categoriaId ? categorias.find((c) => c.id === r.categoriaId) : null;
              const dist = r.distribucionId
                ? plantillas.find((p) => p.id === r.distribucionId)
                : null;
              const cc = r.centroCostoId ? centros.find((c) => c.id === r.centroCostoId) : null;

              let accionLabel = '—';
              if (cat) {
                const extra = dist ? dist.nombre : cc ? cc.nombre : null;
                accionLabel = extra ? `${cat.nombre} / ${extra}` : cat.nombre;
              }

              return (
                <tr key={r.id}>
                  <td className="tabular-nums">{r.prioridad}</td>
                  <td className="font-medium">{r.nombre}</td>
                  <td className="text-sm text-slate-600">
                    {condParts.length > 0 ? condParts.join(', ') : '—'}
                  </td>
                  <td className="text-sm text-slate-600">{accionLabel}</td>
                  <td>{r.activa ? 'Sí' : 'No'}</td>
                  <td className="text-right space-x-3">
                    <Link href={`?editar=${r.id}`} className="text-sm underline text-slate-600">
                      Editar
                    </Link>
                    <form action={toggleRegla} className="inline">
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-sm underline text-slate-600">
                        {r.activa ? 'Desactivar' : 'Activar'}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {reglas.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-6">
                  Sin reglas todavía
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
