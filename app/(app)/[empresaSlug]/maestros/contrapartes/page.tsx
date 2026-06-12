import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ErrorBanner } from '@/components/error-banner';
import { formatearCuit } from '@/lib/checks';
import { guardarContraparte, toggleContraparte } from '../actions';

const TIPO_LABEL = { PROVEEDOR: 'Proveedor', CLIENTE: 'Cliente', AMBOS: 'Ambos' } as const;

export default async function ContrapartesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; editar?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const [contrapartes, categorias, distribuciones] = await Promise.all([
    ctx.db.contraparte.findMany({ orderBy: { razonSocial: 'asc' } }),
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ orderBy: { nombre: 'asc' } }),
  ]);
  const editando = searchParams.editar ? contrapartes.find((c) => c.id === searchParams.editar) : null;

  return (
    <div className="space-y-4">
      <ErrorBanner mensaje={searchParams.error} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">{editando ? `Editar "${editando.razonSocial}"` : 'Nueva contraparte'}</h2>
        <form action={guardarContraparte} className="grid gap-3 md:grid-cols-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          {editando && <input type="hidden" name="id" value={editando.id} />}
          <div>
            <label className="label">CUIT</label>
            <input name="cuit" required className="input" defaultValue={editando?.cuit} placeholder="30-12345678-9" />
          </div>
          <div>
            <label className="label">Razón social</label>
            <input name="razonSocial" required className="input" defaultValue={editando?.razonSocial} />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="tipo" className="input" defaultValue={editando?.tipo ?? 'PROVEEDOR'}>
              <option value="PROVEEDOR">Proveedor</option>
              <option value="CLIENTE">Cliente</option>
              <option value="AMBOS">Ambos</option>
            </select>
          </div>
          <div>
            <label className="label">Condición IVA (opcional)</label>
            <input name="condicionIva" className="input" defaultValue={editando?.condicionIva ?? ''} placeholder="Responsable Inscripto" />
          </div>
          <div>
            <label className="label">Categoría default (opcional)</label>
            <select name="categoriaDefaultId" className="input" defaultValue={editando?.categoriaDefaultId ?? ''}>
              <option value="">— Sin default —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Distribución default (opcional)</label>
            <select name="distribucionDefaultId" className="input" defaultValue={editando?.distribucionDefaultId ?? ''}>
              <option value="">— Sin default —</option>
              {distribuciones.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="label">Instrucciones de extracción (se inyectan al prompt del OCR para este emisor)</label>
            <textarea
              name="instruccionesExtraccion"
              className="input"
              rows={2}
              defaultValue={editando?.instruccionesExtraccion ?? ''}
              placeholder='Ej.: "El número de comprobante figura arriba a la derecha como NRO. INTERNO; ignorar el código de barras."'
            />
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button className="btn-primary">{editando ? 'Guardar cambios' : 'Crear'}</button>
            {editando && (
              <Link href={`/${params.empresaSlug}/maestros/contrapartes`} className="btn-secondary">Cancelar</Link>
            )}
          </div>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>CUIT</th><th>Razón social</th><th>Tipo</th><th>Categoría default</th><th>Distribución default</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {contrapartes.map((c) => (
              <tr key={c.id} className={!c.activa ? 'opacity-50' : ''}>
                <td className="whitespace-nowrap tabular-nums">{formatearCuit(c.cuit)}</td>
                <td className="font-medium">
                  {c.razonSocial}
                  {c.instruccionesExtraccion && (
                    <span title={c.instruccionesExtraccion} className="ml-1 text-xs text-slate-400">📝</span>
                  )}
                </td>
                <td>{TIPO_LABEL[c.tipo]}</td>
                <td>{categorias.find((x) => x.id === c.categoriaDefaultId)?.nombre ?? '—'}</td>
                <td>{distribuciones.find((x) => x.id === c.distribucionDefaultId)?.nombre ?? '—'}</td>
                <td>{c.activa ? 'Activa' : 'Inactiva'}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`?editar=${c.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                  <form action={toggleContraparte} className="inline">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-sm underline text-slate-600">{c.activa ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              </tr>
            ))}
            {contrapartes.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-6">Sin contrapartes todavía</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
