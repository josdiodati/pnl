import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { guardarReglaResumen, toggleReglaResumen } from '../actions';

// Reglas de auto-resolución de líneas de resumen: si el descriptor contiene el
// texto de la condición, la línea se ignora o se imputa automáticamente al
// extraer un resumen nuevo (o con "Aplicar reglas" en la bandeja). También se
// crean desde la propia línea con el checkbox "crear regla".

export default async function ReglasResumenPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const [reglas, categorias, plantillas, centros, clientes, proyectos] = await Promise.all([
    ctx.db.reglaResumen.findMany({ orderBy: [{ createdAt: 'asc' }] }),
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
  ]);

  const editando = searchParams.editar ? reglas.find((r) => r.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <p className="text-sm text-slate-500">
        Estas reglas resuelven líneas de <Link href={`/${params.empresaSlug}/resumenes`} className="underline">resúmenes</Link> automáticamente:
        si el descriptor de la línea contiene la condición, se ignora (pagos del resumen, saldos) o se imputa como gasto.
        Imputar sólo aplica a líneas sin sugerencia de conciliación — si el matching encontró un comprobante, la sugerencia gana.
      </p>

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar «${editando.nombre}»` : 'Nueva regla de resumen'}</h2>
        <form action={guardarReglaResumen} className="space-y-4">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Nombre</label>
              <input name="nombre" required className="input" defaultValue={editando?.nombre} placeholder="Pago de resumen Visa" />
            </div>
            <div>
              <label className="label" title="Se compara sin mayúsculas ni acentos, como el matching">
                El descriptor contiene <span className="text-slate-400">ⓘ</span>
              </label>
              <input
                name="descriptorContiene"
                required
                className="input"
                defaultValue={editando?.descriptorContiene}
                placeholder="SU PAGO EN PESOS"
              />
            </div>
            <div>
              <label className="label">Emisor (opcional)</label>
              <input name="emisor" className="input" defaultValue={editando?.emisor ?? ''} placeholder="— cualquiera —" />
            </div>
            <div>
              <label className="label">Tipo (opcional)</label>
              <select name="tipo" className="input" defaultValue={editando?.tipo ?? ''}>
                <option value="">— cualquiera —</option>
                <option value="TARJETA">Tarjeta</option>
                <option value="BANCO">Banco</option>
              </select>
            </div>
          </div>

          <div className="w-64">
            <label className="label">Acción</label>
            <select name="accion" className="input" defaultValue={editando?.accion ?? 'IGNORAR'}>
              <option value="IGNORAR">Ignorar (no requiere imputación)</option>
              <option value="IMPUTAR">Imputar (categoría + distribución)</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Motivo (para Ignorar)</label>
              <input name="motivoIgnorar" className="input" defaultValue={editando?.motivoIgnorar ?? ''} placeholder="Pago del resumen" />
            </div>
          </div>

          <fieldset className="border border-slate-200 rounded p-3 space-y-3">
            <legend className="text-sm font-medium text-slate-600 px-1">
              Acción Imputar: categoría y una plantilla de distribución, o un centro de costo (línea única 100%). (Se ignora si la acción es «Ignorar».)
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Categoría</label>
                <select name="categoriaId" className="input" defaultValue={editando?.categoriaId ?? ''}>
                  <option value="">— elegir —</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Plantilla de distribución</label>
                <select name="distribucionId" className="input" defaultValue={editando?.distribucionId ?? ''}>
                  <option value="">— ninguna —</option>
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Centro de costo (100%)</label>
                <select name="centroCostoId" className="input" defaultValue={editando?.centroCostoId ?? ''}>
                  <option value="">— ninguno —</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Cliente</label>
                <select name="clienteId" className="input" defaultValue={editando?.clienteId ?? ''}>
                  <option value="">— ninguno —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Proyecto</label>
                <select name="proyectoId" className="input" defaultValue={editando?.proyectoId ?? ''}>
                  <option value="">— ninguno —</option>
                  {proyectos.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <div className="flex gap-2">
            <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear regla'}</button>
            {editando && (
              <Link href={`/${params.empresaSlug}/maestros/reglas-resumen`} className="btn-secondary">Cancelar</Link>
            )}
          </div>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Condición</th>
              <th>Acción</th>
              <th>Activa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reglas.map((r) => {
              const condParts = [`«${r.descriptorContiene}»`];
              if (r.emisor) condParts.push(r.emisor);
              if (r.tipo) condParts.push(r.tipo === 'TARJETA' ? 'Tarjeta' : 'Banco');

              let accionLabel: string;
              if (r.accion === 'IGNORAR') {
                accionLabel = `Ignorar${r.motivoIgnorar ? ` (${r.motivoIgnorar})` : ''}`;
              } else {
                const cat = r.categoriaId ? categorias.find((c) => c.id === r.categoriaId) : null;
                const dist = r.distribucionId ? plantillas.find((p) => p.id === r.distribucionId) : null;
                const cc = r.centroCostoId ? centros.find((c) => c.id === r.centroCostoId) : null;
                const extra = dist ? dist.nombre : cc ? cc.nombre : null;
                accionLabel = `Imputar: ${cat?.nombre ?? '—'}${extra ? ` / ${extra}` : ''}`;
              }

              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.nombre}</td>
                  <td className="text-sm text-slate-600">{condParts.join(', ')}</td>
                  <td className="text-sm text-slate-600">{accionLabel}</td>
                  <td>{r.activa ? 'Sí' : 'No'}</td>
                  <td className="text-right space-x-3">
                    <Link href={`?editar=${r.id}`} className="text-sm underline text-slate-600">Editar</Link>
                    <form action={toggleReglaResumen} className="inline">
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-sm underline text-slate-600">{r.activa ? 'Desactivar' : 'Activar'}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {reglas.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  Sin reglas todavía. Se crean desde una línea de resumen (checkbox «crear regla») o acá.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
