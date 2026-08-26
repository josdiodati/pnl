import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL } from '@/lib/periodos';
import { formatMoney, formatFecha } from '@/lib/format';
import { formatearCuit } from '@/lib/checks/cuit';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { OkBanner } from '@/components/error-banner';
import {
  guardarFichaAction, guardarDistribucionAction, vincularAction, desvincularAction,
  agregarCostoManualAction, eliminarCostoManualAction,
} from '../actions';

// Ficha del empleado: datos editables, distribución por defecto, historial de
// costo por período y comprobantes vinculados (prepaga, etc.).
export default async function EmpleadoPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const empleado = await ctx.db.empleado.findFirst({
    where: { id: params.id },
    include: {
      distribucion: true,
      recibos: { include: { periodo: true }, orderBy: { createdAt: 'desc' } },
      vinculos: { include: { movimiento: { include: { contraparte: true, periodo: true } } } },
      costosManuales: { include: { periodo: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!empleado) notFound();

  const [centros, clientes, proyectos, movimientosVinculables] = await Promise.all([
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.movimiento.findMany({
      where: { estado: 'ASIGNADO', total: { not: null } },
      include: { contraparte: true },
      orderBy: [{ fechaDevengamiento: 'desc' }],
      take: 100,
    }),
  ]);

  // Historial: recibos confirmados + vinculados, agrupados por período.
  const porPeriodo = new Map<string, { anio: number; mes: number; mensual: number; sac: number; otros: number; vinculado: number; individual: number }>();
  const bucket = (anio: number, mes: number) => {
    const k = `${anio}-${mes}`;
    if (!porPeriodo.has(k)) porPeriodo.set(k, { anio, mes, mensual: 0, sac: 0, otros: 0, vinculado: 0, individual: 0 });
    return porPeriodo.get(k)!;
  };
  for (const r of empleado.recibos) {
    if (r.estado !== 'CONFIRMADO' || r.costoTotalEmpleador == null) continue;
    const b = bucket(r.periodo.anio, r.periodo.mes);
    const monto = Number(r.costoTotalEmpleador);
    if (r.tipo === 'MENSUAL') b.mensual += monto;
    else if (r.tipo === 'SAC') b.sac += monto;
    else b.otros += monto;
  }
  for (const v of empleado.vinculos) {
    if (v.movimiento.estado !== 'ASIGNADO' || !v.movimiento.periodo) continue;
    bucket(v.movimiento.periodo.anio, v.movimiento.periodo.mes).vinculado += Number(v.monto);
  }
  // Los costos individuales son SEGUIMIENTO: se muestran en su columna pero no
  // suman al costo total contable (el gasto real entra por la factura agregada).
  for (const c of empleado.costosManuales) {
    bucket(c.periodo.anio, c.periodo.mes).individual += Number(c.monto);
  }
  const historial = [...porPeriodo.values()].sort((a, b) => b.anio - a.anio || b.mes - a.mes);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{empleado.nombre}</h1>
        <p className="text-xs text-slate-500">
          CUIL {formatearCuit(empleado.cuil)} · legajo {empleado.legajo ?? '—'} · ingreso {formatFecha(empleado.fechaIngreso)}
        </p>
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}

      <div className="grid lg:grid-cols-2 gap-4">
        <form action={guardarFichaAction} className="card p-3 space-y-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <p className="text-sm font-medium">Ficha</p>
          <div>
            <label className="label">Nombre</label>
            <input name="nombre" defaultValue={empleado.nombre} className="input text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Legajo</label>
              <input name="legajo" defaultValue={empleado.legajo ?? ''} className="input text-sm" />
            </div>
            <div>
              <label className="label">Categoría</label>
              <input name="categoria" defaultValue={empleado.categoria ?? ''} className="input text-sm" />
            </div>
            <div>
              <label className="label">Sector</label>
              <input name="sector" defaultValue={empleado.sector ?? ''} className="input text-sm" />
            </div>
            <div>
              <label className="label">Fecha de egreso</label>
              <input
                type="date"
                name="fechaEgreso"
                defaultValue={empleado.fechaEgreso?.toISOString().slice(0, 10) ?? ''}
                className="input text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="activo" value="1" defaultChecked={empleado.activo} /> Activo
          </label>
          <button className="btn-primary text-sm">Guardar ficha</button>
        </form>

        <form action={guardarDistribucionAction} className="card p-3 space-y-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <p className="text-sm font-medium">Distribución por defecto</p>
          <p className="text-xs text-slate-500">Cada recibo nuevo la hereda al confirmarse. Cambiarla no toca recibos ya confirmados.</p>
          <DistribucionEditor
            centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
            clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
            proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre }))}
            inicial={empleado.distribucion.map((l) => ({
              centroCostoId: l.centroCostoId,
              clienteId: l.clienteId ?? '',
              proyectoId: l.proyectoId ?? '',
              porcentaje: String(Number(l.porcentaje)),
            }))}
          />
          <button className="btn-primary text-sm">Guardar distribución</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-sm font-medium p-3 pb-0">Costo por período</p>
        <table className="table-base">
          <thead>
            <tr>
              <th>Período</th>
              <th className="text-right">Mensual</th>
              <th className="text-right">SAC</th>
              <th className="text-right">Otros recibos</th>
              <th className="text-right">Vinculados</th>
              <th className="text-right">Costo total</th>
              <th className="text-right" title="Seguimiento manual: no suma al costo total contable">Individual (seg.)</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((h) => (
              <tr key={`${h.anio}-${h.mes}`}>
                <td>{MES_LABEL[h.mes]} {h.anio}</td>
                <td className="num">{h.mensual ? formatMoney(h.mensual) : '—'}</td>
                <td className="num">{h.sac ? formatMoney(h.sac) : '—'}</td>
                <td className="num">{h.otros ? formatMoney(h.otros) : '—'}</td>
                <td className="num">{h.vinculado ? formatMoney(h.vinculado) : '—'}</td>
                <td className="num font-medium">{formatMoney(h.mensual + h.sac + h.otros + h.vinculado)}</td>
                <td className="num text-slate-500">{h.individual ? formatMoney(h.individual) : '—'}</td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-6">Sin costos registrados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-3 pb-3 text-[11px] text-slate-500">
          «Individual (seg.)» es seguimiento manual (ej. su plan de prepaga): no suma al costo total contable — ese
          gasto ya entra una vez por la factura agregada de la categoría de personal.
        </p>
      </div>

      <div className="card p-3 space-y-3">
        <p className="text-sm font-medium">Costos individuales (seguimiento)</p>
        {empleado.costosManuales.map((c) => (
          <form key={c.id} action={eliminarCostoManualAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="empleadoId" value={empleado.id} />
            <input type="hidden" name="costoId" value={c.id} />
            <span className="grow">
              {MES_LABEL[c.periodo.mes]} {c.periodo.anio} · {c.concepto}
            </span>
            <span className="num font-medium">{formatMoney(Number(c.monto))}</span>
            <button className="btn-secondary text-xs">Quitar</button>
          </form>
        ))}
        <form action={agregarCostoManualAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <div>
            <label className="label">Mes</label>
            <select name="mes" className="input text-sm" defaultValue={new Date().getMonth() + 1}>
              {MES_LABEL.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Año</label>
            <input name="anio" type="number" className="input text-sm w-24" defaultValue={new Date().getFullYear()} />
          </div>
          <div className="grow min-w-48">
            <label className="label">Concepto</label>
            <input name="concepto" className="input text-sm" placeholder="p.ej. Plan OSDE 210" />
          </div>
          <div>
            <label className="label">Monto ($)</label>
            <input name="monto" className="input text-sm w-32" placeholder="0,00" />
          </div>
          <button className="btn-primary text-sm">Agregar</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-sm font-medium p-3 pb-0">Recibos</p>
        <table className="table-base">
          <thead>
            <tr>
              <th>Período</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th className="text-right">Costo total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {empleado.recibos.map((r) => (
              <tr key={r.id}>
                <td>{MES_LABEL[r.periodo.mes]} {r.periodo.anio}</td>
                <td className="text-xs">{r.tipo}</td>
                <td className="text-xs">{r.estado}{r.nota ? ` · ${r.nota}` : ''}</td>
                <td className="num">{r.costoTotalEmpleador ? formatMoney(Number(r.costoTotalEmpleador)) : '—'}</td>
                <td><Link href={`/${params.empresaSlug}/empleados/recibos/${r.id}`} className="btn-secondary text-xs">Ver</Link></td>
              </tr>
            ))}
            {empleado.recibos.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">Sin recibos cargados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-3 space-y-3">
        <p className="text-sm font-medium">Comprobantes vinculados</p>
        <p className="text-xs text-slate-500">La porción vinculada computa como costo de este empleado (con su distribución) y se descuenta del gasto general del libro.</p>
        {empleado.vinculos.map((v) => (
          <form key={v.id} action={desvincularAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="empleadoId" value={empleado.id} />
            <input type="hidden" name="movimientoId" value={v.movimientoId} />
            <span className="grow">
              {v.movimiento.contraparte?.razonSocial ?? v.movimiento.descripcion ?? v.movimientoId} · {formatFecha(v.movimiento.fechaDevengamiento)} · total {formatMoney(v.movimiento.total ? Number(v.movimiento.total) : null)}
            </span>
            <span className="num font-medium">{formatMoney(Number(v.monto))}</span>
            <button className="btn-secondary text-xs" disabled={v.movimiento.periodo?.estado === 'CERRADO'}>Quitar</button>
          </form>
        ))}
        {empleado.vinculos.length === 0 && <p className="text-xs text-slate-400">Sin comprobantes vinculados.</p>}
        <form action={vincularAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <div className="grow min-w-64">
            <label className="label">Comprobante (asignados recientes)</label>
            <select name="movimientoId" className="input text-sm">
              {movimientosVinculables.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.contraparte?.razonSocial ?? m.descripcion ?? m.id} · {m.fechaDevengamiento?.toISOString().slice(0, 10) ?? ''} · ${Number(m.total).toLocaleString('es-AR')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Monto vinculado ($)</label>
            <input name="monto" className="input text-sm w-36" placeholder="0,00" />
          </div>
          <button className="btn-primary text-sm">Vincular</button>
        </form>
      </div>
    </div>
  );
}
