import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { getFileStorage } from '@/lib/storage';
import { MES_LABEL } from '@/lib/periodos';
import { formatearCuit } from '@/lib/checks/cuit';
import { DocViewer } from '@/components/doc-viewer';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { confirmarReciboAction, anularReciboAction, reasignarReciboAction } from '../../actions';

// Revisión de un recibo extraído: documento original a la izquierda, totales
// editables (con los avisos de camposRevisar) + distribución a la derecha.
export default async function ReciboPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const recibo = await ctx.db.reciboSueldo.findFirst({
    where: { id: params.id },
    include: { empleado: { include: { distribucion: true } }, periodo: true, lineas: true },
  });
  if (!recibo) notFound();

  const [centros, clientes, proyectos, fileUrl] = await Promise.all([
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    recibo.archivoKey ? getFileStorage().getSignedUrl(recibo.archivoKey) : Promise.resolve(null),
  ]);

  const revisar = (recibo.camposRevisar as Record<string, string> | null) ?? {};
  const conceptos = (recibo.conceptos as { concepto: string; unidad: string | null; importe: number; naturaleza: string }[] | null) ?? [];
  // Distribución inicial: la del recibo si ya tiene, si no la de la ficha.
  const lineasIniciales = (recibo.lineas.length ? recibo.lineas : recibo.empleado.distribucion).map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId ?? '',
    proyectoId: l.proyectoId ?? '',
    porcentaje: String(Number(l.porcentaje)),
  }));

  const totales: { name: string; label: string; valor: unknown }[] = [
    { name: 'brutoRemunerativo', label: 'Bruto remunerativo', valor: recibo.brutoRemunerativo },
    { name: 'noRemunerativo', label: 'No remunerativo', valor: recibo.noRemunerativo },
    { name: 'retenciones', label: 'Retenciones', valor: recibo.retenciones },
    { name: 'sueldoNeto', label: 'Sueldo neto', valor: recibo.sueldoNeto },
    { name: 'contribucionesEmpleador', label: 'Contribuciones empleador', valor: recibo.contribucionesEmpleador },
    { name: 'costoTotalEmpleador', label: 'COSTO TOTAL EMPLEADOR', valor: recibo.costoTotalEmpleador },
  ];

  const editable = recibo.estado === 'PENDIENTE_REVISION' && recibo.periodo.estado === 'ABIERTO';

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-2 min-h-[70vh]">
        {fileUrl ? (
          <DocViewer
            url={`${fileUrl}#page=${recibo.pagina ?? 1}`}
            mime={recibo.archivoMime ?? 'application/pdf'}
            nombre={recibo.archivoNombre ?? 'recibo'}
          />
        ) : (
          <p className="text-sm text-slate-400 p-4">Sin archivo adjunto</p>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">
            {recibo.empleado.nombre} · {recibo.tipo} · {MES_LABEL[recibo.periodo.mes]} {recibo.periodo.anio}
          </h1>
          <p className="text-xs text-slate-500">
            CUIL {formatearCuit(recibo.empleado.cuil)} · página {recibo.pagina} de {recibo.archivoNombre} · estado {recibo.estado}
          </p>
        </div>
        {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
        {searchParams.ok && <p className="text-sm text-emerald-700">{searchParams.ok}</p>}
        {recibo.nota && <p className="text-sm text-amber-700">{recibo.nota}</p>}

        <form action={confirmarReciboAction} className="space-y-4">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="reciboId" value={recibo.id} />

          <div className="card p-3 grid grid-cols-2 gap-2">
            {totales.map((t) => (
              <div key={t.name}>
                <label className="label">{t.label}</label>
                <input
                  name={t.name}
                  defaultValue={t.valor != null ? String(Number(t.valor)) : ''}
                  disabled={!editable}
                  className={`input text-sm ${revisar[t.name] ? 'border-amber-400' : ''}`}
                />
                {revisar[t.name] && <p className="text-[11px] text-amber-700 mt-0.5">{revisar[t.name]}</p>}
              </div>
            ))}
            {revisar.empleado && <p className="col-span-2 text-[11px] text-amber-700">{revisar.empleado}</p>}
          </div>

          {conceptos.length > 0 && (
            <div className="card p-3 overflow-x-auto">
              <p className="text-xs text-slate-500 mb-1">Conceptos extraídos</p>
              <table className="table-base text-xs">
                <tbody>
                  {conceptos.map((c, i) => (
                    <tr key={i}>
                      <td>{c.concepto}</td>
                      <td className="text-slate-400">{c.unidad ?? ''}</td>
                      <td className="text-slate-400">{c.naturaleza.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="num">{c.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card p-3">
            <p className="text-xs text-slate-500 mb-2">Distribución (pre-cargada desde la ficha; el ajuste vale sólo para este recibo)</p>
            <DistribucionEditor
              centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
              clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre, centroCostoId: c.centroCostoId }))}
              proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre, clienteId: p.clienteId }))}
              inicial={lineasIniciales}
            />
          </div>

          {editable && <button className="btn-primary">Confirmar recibo</button>}
          {recibo.periodo.estado === 'CERRADO' && (
            <p className="text-sm text-amber-700">El período está cerrado: el recibo no se puede modificar.</p>
          )}
          {recibo.estado === 'CONFIRMADO' && recibo.periodo.estado === 'ABIERTO' && (
            <div className="space-y-1">
              {/* Reasignar: corrige la distribución de un mes ya confirmado sin
                  anular nada (los totales no se tocan por este camino). */}
              <button formAction={reasignarReciboAction} className="btn-primary">
                Guardar reasignación
              </button>
              <p className="text-xs text-slate-500">
                Este recibo ya está confirmado. Podés corregir su distribución acá; para los meses futuros cambiá la
                distribución en la ficha del empleado.
              </p>
            </div>
          )}
          {recibo.estado === 'ANULADO' && <p className="text-sm text-slate-500">Este recibo está anulado.</p>}
        </form>

        {recibo.estado !== 'ANULADO' && recibo.periodo.estado === 'ABIERTO' && (
          <form action={anularReciboAction} className="flex gap-2 items-end">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="reciboId" value={recibo.id} />
            <div className="grow">
              <label className="label">Motivo de anulación</label>
              <input name="nota" className="input text-sm" placeholder="p.ej. recibo rectificado" />
            </div>
            <button className="btn-secondary">Anular</button>
          </form>
        )}
      </div>
    </div>
  );
}
