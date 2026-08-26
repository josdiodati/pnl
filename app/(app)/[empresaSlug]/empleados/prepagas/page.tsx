import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha, ejercicioDeMes, mesesDeEjercicio } from '@/lib/periodos';
import { netoPrepaga, aportesObraSocialDeConceptos, type ConceptoRecibo } from '@/lib/empleados/prepaga';
import { OkBanner } from '@/components/error-banner';
import { guardarPrepagaAction, eliminarPrepagaAction } from '../actions';

// Personal → Prepagas: costo REAL de la prepaga de cada empleado (vista de
// gestión, no contable): neto = plan − FSR% × (aportes + contribuciones de
// obra social). El libro sigue mostrando las facturas agregadas; acá se asigna
// lo que alimenta las vistas de empleados y los reportes de proyectos.

const fmt = (centavos: number) => (centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 });

export default async function PrepagasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ejercicio?: string; editar?: string; anio?: string; mes?: string; ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const base = `/${params.empresaSlug}/empleados/prepagas`;
  const hoy = periodoDeFecha(new Date());
  const inicio = ctx.empresa.inicioEjercicioFiscal;
  const ejercicio = Number(searchParams.ejercicio ?? ejercicioDeMes(hoy.anio, hoy.mes, inicio));
  const meses = mesesDeEjercicio(ejercicio, inicio);

  const periodos = await ctx.db.periodo.findMany({
    where: { OR: meses.map((m) => ({ anio: m.anio, mes: m.mes })) },
  });
  const periodoPorId = new Map(periodos.map((p) => [p.id, p]));

  const [empleados, registros] = await Promise.all([
    ctx.db.empleado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.prepagaEmpleado.findMany({
      where: { periodoId: { in: periodos.map((p) => p.id) } },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const col = new Map(meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const porEmpleadoMes = new Map<string, (typeof registros)[number]>();
  for (const r of registros) {
    const p = periodoPorId.get(r.periodoId)!;
    porEmpleadoMes.set(`${r.empleadoId}|${p.anio}-${p.mes}`, r);
  }
  const nombrePlan = (empleadoId: string) => {
    const propios = registros.filter((r) => r.empleadoId === empleadoId);
    return propios.length ? propios[0].prepaga : null;
  };

  // ---------- Panel de edición (celda clickeada) ----------
  let panelEdicion: React.ReactNode = null;
  if (searchParams.editar) {
    const empleado = empleados.find((e) => e.id === searchParams.editar);
    const anio = Number(searchParams.anio ?? hoy.anio);
    const mes = Number(searchParams.mes ?? hoy.mes);
    if (empleado) {
      const existente = porEmpleadoMes.get(`${empleado.id}|${anio}-${mes}`) ?? null;
      // Arrastre: sin registro del mes, propone el del mes anterior del empleado.
      const mesPrevio = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
      const anterior = porEmpleadoMes.get(`${empleado.id}|${mesPrevio.anio}-${mesPrevio.mes}`) ?? null;
      // Precarga de aportes/contribuciones desde el recibo mensual del período.
      const recibo = await ctx.db.reciboSueldo.findFirst({
        where: { empleadoId: empleado.id, tipo: 'MENSUAL', estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] }, periodo: { anio, mes } },
      });
      const os = aportesObraSocialDeConceptos(recibo?.conceptos as ConceptoRecibo[] | null);
      const val = (propio: unknown, fallback: number) => (propio != null ? Number(propio) : fallback);

      panelEdicion = (
        <div className="card p-4 border-sky-200">
          <p className="text-sm font-medium mb-2">
            {empleado.nombre} · {MES_LABEL[mes]} {anio}
            {!existente && anterior && <span className="ml-2 text-xs text-slate-500">(propuesto del mes anterior)</span>}
            {!existente && !anterior && recibo && <span className="ml-2 text-xs text-slate-500">(aportes precargados del recibo)</span>}
          </p>
          <form action={guardarPrepagaAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="empleadoId" value={empleado.id} />
            <input type="hidden" name="anio" value={anio} />
            <input type="hidden" name="mes" value={mes} />
            <div className="w-44">
              <label className="label">Prepaga / plan</label>
              <input name="prepaga" required className="input text-sm" defaultValue={existente?.prepaga ?? anterior?.prepaga ?? ''} placeholder="OSDE 210" />
            </div>
            <div className="w-36">
              <label className="label">Costo del plan ($)</label>
              <input name="costoPlan" required className="input text-sm text-right" inputMode="decimal" defaultValue={val(existente?.costoPlan, anterior ? Number(anterior.costoPlan) : 0) || ''} />
            </div>
            <div className="w-36">
              <label className="label" title="Aporte del empleado a la obra social (3%), del recibo del período">Aportes OS ($)</label>
              <input name="aportes" className="input text-sm text-right" inputMode="decimal" defaultValue={val(existente?.aportes, os.aportes) || ''} />
            </div>
            <div className="w-36">
              <label className="label" title="Contribución patronal de obra social, del recibo del período">Contribuciones OS ($)</label>
              <input name="contribuciones" className="input text-sm text-right" inputMode="decimal" defaultValue={val(existente?.contribuciones, os.contribuciones) || ''} />
            </div>
            <div className="w-28">
              <label className="label" title="Porcentaje de aportes+contribuciones que llega a la prepaga (el FSR retiene el resto)">% a prepaga</label>
              <input name="fsrPct" className="input text-sm text-right" inputMode="decimal" defaultValue={existente ? Number(existente.fsrPct) : 85} />
            </div>
            <button className="btn-primary text-sm">Guardar</button>
            <Link href={`${base}?ejercicio=${ejercicio}`} className="btn-secondary text-sm">Cancelar</Link>
          </form>
          {existente && (
            <form action={eliminarPrepagaAction} className="mt-2">
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <input type="hidden" name="empleadoId" value={empleado.id} />
              <input type="hidden" name="prepagaId" value={existente.id} />
              <button className="text-xs text-red-600 underline">Eliminar el registro de este mes</button>
            </form>
          )}
          {recibo == null && (
            <p className="mt-2 text-xs text-amber-700">
              Ojo: no hay recibo mensual de {MES_LABEL[mes]} para precargar aportes — si la factura viene desfasada,
              cargá los aportes del período que corresponda.
            </p>
          )}
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Prepagas por empleado</h1>
          <p className="text-xs text-slate-500">
            Costo real de gestión: plan − % × (aportes + contribuciones de obra social). No es la vista contable — el
            libro sigue mostrando las facturas de las prepagas como agregado.
          </p>
        </div>
        <Link href={`/${params.empresaSlug}/empleados`} className="btn-secondary text-sm">← Empleados</Link>
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}

      <div className="flex items-center gap-2">
        <Link href={`${base}?ejercicio=${ejercicio - 1}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">Ejercicio {ejercicio}/{ejercicio + 1}</span>
        <Link href={`${base}?ejercicio=${ejercicio + 1}`} className="btn-secondary text-xs">→</Link>
        <span className="text-xs text-slate-400 ml-2">neto mensual en $ · click en una celda para cargar o editar</span>
      </div>

      {panelEdicion}

      <div className="card overflow-x-auto">
        <table className="table-base text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 min-w-52">Empleado</th>
              <th className="whitespace-nowrap">Prepaga</th>
              {meses.map((m) => (
                <th key={`${m.anio}-${m.mes}`} className="text-right whitespace-nowrap">
                  {MES_LABEL[m.mes].slice(0, 3)} {String(m.anio).slice(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empleados.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="sticky left-0 bg-white whitespace-nowrap">
                  <Link href={`/${params.empresaSlug}/empleados/${e.id}`} className="hover:underline">{e.nombre}</Link>
                </td>
                <td className="text-slate-500 whitespace-nowrap">{nombrePlan(e.id) ?? '—'}</td>
                {meses.map((m) => {
                  const r = porEmpleadoMes.get(`${e.id}|${m.anio}-${m.mes}`);
                  const neto = r
                    ? netoPrepaga({
                        costoPlan: Number(r.costoPlan),
                        aportes: Number(r.aportes),
                        contribuciones: Number(r.contribuciones),
                        fsrPct: Number(r.fsrPct),
                      })
                    : null;
                  return (
                    <td key={`${m.anio}-${m.mes}`} className="text-right tabular-nums whitespace-nowrap">
                      <Link
                        href={`${base}?ejercicio=${ejercicio}&editar=${e.id}&anio=${m.anio}&mes=${m.mes}`}
                        className={`hover:underline ${neto == null ? 'text-slate-300' : neto < 0 ? 'text-emerald-600' : ''}`}
                        title={neto != null && neto < 0 ? 'Los aportes superan el plan: en reportes computa 0' : undefined}
                      >
                        {neto == null ? '+' : fmt(neto)}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
            {empleados.length === 0 && (
              <tr><td colSpan={meses.length + 2} className="text-center text-slate-400 py-8">Sin empleados.</td></tr>
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-slate-500">
          Un neto en verde es negativo (los aportes derivados superan el plan): informativo, en las vistas de empleados
          y proyectos computa 0. Los aportes/contribuciones se precargan del recibo del período y se pueden corregir a
          mano si la facturación viene desfasada.
        </p>
      </div>
    </div>
  );
}
