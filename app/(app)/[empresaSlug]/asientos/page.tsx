import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { AsientoManualForm, VentaManualForm } from '@/components/asiento-forms';
import { formatMoney } from '@/lib/format';
import { guardarPlantillaRecurrente, togglePlantillaRecurrente, generarRecurrentesAction } from './actions';

export default async function AsientosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; ok?: string; tab?: string; editarRecurrente?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  const [categorias, contrapartes, centros, clientes, proyectos, plantillasDist, recurrentes] = await Promise.all([
    ctx.db.categoria.findMany({ where: { activa: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] }),
    ctx.db.contraparte.findMany({ where: { activa: true }, orderBy: { razonSocial: 'asc' } }),
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.plantillaDistribucion.findMany({ include: { lineas: true }, orderBy: { nombre: 'asc' } }),
    esValidador ? ctx.db.plantillaRecurrente.findMany({ orderBy: { nombre: 'asc' } }) : Promise.resolve([]),
  ]);

  const tab = searchParams.tab === 'venta' ? 'venta' : searchParams.tab === 'recurrentes' && esValidador ? 'recurrentes' : 'asiento';
  const editandoRec = searchParams.editarRecurrente
    ? recurrentes.find((p) => p.id === searchParams.editarRecurrente)
    : null;

  const propsForms = {
    empresaSlug: params.empresaSlug,
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, padreId: c.padreId })),
    contrapartes: contrapartes.map((c) => ({ id: c.id, razonSocial: c.razonSocial, tipo: c.tipo })),
    centros: centros.map((c) => ({ id: c.id, nombre: c.nombre })),
    clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, centroCostoId: c.centroCostoId })),
    proyectos: proyectos.map((c) => ({ id: c.id, nombre: c.nombre, clienteId: c.clienteId })),
    plantillas: plantillasDist.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      lineas: p.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId,
        proyectoId: l.proyectoId,
        porcentaje: Number(l.porcentaje),
      })),
    })),
    puedeValidar: esValidador,
  };

  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Asientos y ventas manuales</h1>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="flex gap-1 border-b border-slate-200">
        <Link href="?tab=asiento" className={`px-3 py-2 text-sm ${tab === 'asiento' ? 'border-b-2 border-slate-800 font-medium' : 'text-slate-500'}`}>
          Asiento manual
        </Link>
        <Link href="?tab=venta" className={`px-3 py-2 text-sm ${tab === 'venta' ? 'border-b-2 border-slate-800 font-medium' : 'text-slate-500'}`}>
          Venta manual
        </Link>
        {esValidador && (
          <Link href="?tab=recurrentes" className={`px-3 py-2 text-sm ${tab === 'recurrentes' ? 'border-b-2 border-slate-800 font-medium' : 'text-slate-500'}`}>
            Plantillas recurrentes
          </Link>
        )}
      </div>

      {tab === 'asiento' && (
        <div className="card p-4 max-w-3xl">
          <p className="text-sm text-slate-500 mb-3">
            Para movimientos que no nacen de una factura: sueldos, cargas sociales, impuestos, ajustes.
          </p>
          <AsientoManualForm {...propsForms} />
        </div>
      )}

      {tab === 'venta' && (
        <div className="card p-4 max-w-3xl">
          <p className="text-sm text-slate-500 mb-3">
            Registro de una venta emitida (la lectura automática desde ARCA es etapa futura).
          </p>
          <VentaManualForm {...propsForms} />
        </div>
      )}

      {tab === 'recurrentes' && esValidador && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <form action={generarRecurrentesAction} className="flex items-end gap-3">
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <div>
                <label className="label">Mes</label>
                <input type="month" name="mes" defaultValue={mesActual} className="input" />
              </div>
              <button className="btn-primary">Generar recurrentes del mes</button>
            </form>
            <p className="text-xs text-slate-500 max-w-md">
              Crea un asiento pendiente de validación por cada plantilla activa. Las plantillas con &quot;importe del mes
              anterior&quot; copian el último validado.
            </p>
          </div>

          <div className="card p-4 max-w-3xl">
            <h2 className="font-medium mb-3">{editandoRec ? `Editar "${editandoRec.nombre}"` : 'Nueva plantilla recurrente'}</h2>
            <form action={guardarPlantillaRecurrente} className="grid sm:grid-cols-3 gap-3">
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              {editandoRec && <input type="hidden" name="id" value={editandoRec.id} />}
              <div>
                <label className="label">Nombre</label>
                <input name="nombre" required className="input" defaultValue={editandoRec?.nombre} placeholder="Honorarios Legales" />
              </div>
              <div>
                <label className="label">Categoría</label>
                <select name="categoriaId" required className="input" defaultValue={editandoRec?.categoriaId ?? ''}>
                  <option value="">Elegir…</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Importe sugerido</label>
                <input name="importeSugerido" required inputMode="decimal" className="input text-right tabular-nums" defaultValue={editandoRec ? String(Number(editandoRec.importeSugerido)) : ''} />
              </div>
              <div>
                <label className="label">Día del mes (1-28)</label>
                <input name="diaDelMes" type="number" min={1} max={28} className="input" defaultValue={editandoRec?.diaDelMes ?? 1} />
              </div>
              <div>
                <label className="label">Distribución</label>
                <select name="distribucionId" className="input" defaultValue={editandoRec?.distribucionId ?? ''}>
                  <option value="">Primer centro de costo, 100%</option>
                  {plantillasDist.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Descripción (opcional)</label>
                <input name="descripcion" className="input" defaultValue={editandoRec?.descripcion ?? ''} />
              </div>
              <label className="flex items-center gap-1.5 text-sm text-slate-600 sm:col-span-2">
                <input type="checkbox" name="usarImporteMesAnterior" defaultChecked={editandoRec?.usarImporteMesAnterior} />
                Usar el importe validado del mes anterior (sueldos)
              </label>
              <div className="flex gap-2">
                <button className="btn-primary">{editandoRec ? 'Guardar' : 'Crear'}</button>
                {editandoRec && <Link href="?tab=recurrentes" className="btn-secondary">Cancelar</Link>}
              </div>
            </form>
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Nombre</th><th>Categoría</th><th className="text-right">Importe sugerido</th><th>Día</th><th>Importe mes anterior</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {recurrentes.map((p) => (
                  <tr key={p.id} className={!p.activa ? 'opacity-50' : ''}>
                    <td className="font-medium">{p.nombre}</td>
                    <td>{categorias.find((c) => c.id === p.categoriaId)?.nombre ?? '—'}</td>
                    <td className="num">{formatMoney(Number(p.importeSugerido))}</td>
                    <td>{p.diaDelMes}</td>
                    <td>{p.usarImporteMesAnterior ? 'Sí' : 'No'}</td>
                    <td>{p.activa ? 'Activa' : 'Inactiva'}</td>
                    <td className="text-right whitespace-nowrap">
                      <Link href={`?tab=recurrentes&editarRecurrente=${p.id}`} className="text-sm underline text-slate-600 mr-3">Editar</Link>
                      <form action={togglePlantillaRecurrente} className="inline">
                        <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-sm underline text-slate-600">{p.activa ? 'Desactivar' : 'Activar'}</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {recurrentes.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-400 py-6">Sin plantillas recurrentes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
