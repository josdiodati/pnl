import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { MES_LABEL, ejercicioDeMes } from '@/lib/periodos';
import { formatFechaHora } from '@/lib/format';
import { estadoCierre, claveMes } from '@/lib/periodos/cierre';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { cerrarPeriodoAction, reabrirPeriodoAction } from '../actions';

// Detalle de cierre de un mes (/periodos/2026-09): cómo están comprobantes,
// resúmenes, ARCA y sueldos, cada número linkeado a la sección donde se
// resuelve. Sólo los comprobantes sin resolver impiden cerrar (misma regla que
// cerrarPeriodo); lo demás es informativo. El botón Cerrar vive acá.

type Item = { texto: string; href?: string; tono: 'ok' | 'bloquea' | 'aviso' | 'info' };

const TONO: Record<Item['tono'], string> = {
  ok: 'text-emerald-700',
  bloquea: 'text-red-700 font-medium',
  aviso: 'text-amber-700',
  info: 'text-slate-500',
};

export default async function PeriodoDetallePage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; mes: string };
  searchParams: { error?: string; ok?: string };
}) {
  const m = /^(\d{4})-(\d{2})$/.exec(params.mes);
  if (!m) notFound();
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) notFound();

  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const esAdmin = rolAlcanza(ctx.rol, 'ADMINISTRADOR');
  const base = `/${params.empresaSlug}`;
  const [estados, periodo] = await Promise.all([
    estadoCierre(ctx.db, ctx.empresa.id, [{ anio, mes }]),
    ctx.db.periodo.findFirst({ where: { anio, mes } }),
  ]);
  const e = estados.get(claveMes(anio, mes))!;
  const cerrado = periodo?.estado === 'CERRADO';
  const cerradoPor = periodo?.cerradoPorId
    ? await ctx.db.usuarioEmpresa.findFirst({ where: { usuarioId: periodo.cerradoPorId }, include: { usuario: { select: { nombre: true, email: true } } } })
    : null;

  const mm = String(mes).padStart(2, '0');
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const rango = `desde=${anio}-${mm}-01&hasta=${anio}-${mm}-${ultimoDia}`;
  const comprobantes = (estado: string) => `${base}/comprobantes?lado=todos&${rango}&estado=${estado}`;
  const ejercicio = ejercicioDeMes(anio, mes, ctx.empresa.inicioEjercicioFiscal);
  const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

  const c = e.comprobantes;
  const itemsComprobantes: Item[] = [
    ...(c.porValidar ? [{ texto: `${plural(c.porValidar, 'comprobante')} por validar`, href: comprobantes('PENDIENTE_VALIDACION'), tono: 'bloquea' as const }] : []),
    ...(c.observados ? [{ texto: `${plural(c.observados, 'observado')}`, href: comprobantes('OBSERVADO'), tono: 'bloquea' as const }] : []),
    ...(c.porAsignar ? [{ texto: `${plural(c.porAsignar, 'comprobante')} por asignar`, href: comprobantes('VALIDADO'), tono: 'bloquea' as const }] : []),
    ...(c.retenidos ? [{ texto: `${plural(c.retenidos, 'retenido')} (llegaron con el mes cerrado)`, href: comprobantes('RETENIDO'), tono: 'bloquea' as const }] : []),
    ...(c.conError ? [{ texto: `${plural(c.conError, 'comprobante')} con error de procesamiento`, href: comprobantes('ERROR_PROCESAMIENTO'), tono: 'aviso' as const }] : []),
  ];
  if (!itemsComprobantes.length) itemsComprobantes.push({ texto: 'Todos validados y asignados', href: `${base}/comprobantes?lado=todos&${rango}`, tono: 'ok' });

  const itemsResumenes: Item[] = e.resumenes.length
    ? e.resumenes.map((r) => ({
        texto:
          r.estado === 'ERROR_PROCESAMIENTO'
            ? `${r.emisor}: error al procesar el resumen`
            : r.estado === 'PROCESANDO'
              ? `${r.emisor}: procesando…`
              : r.sinConciliar
                ? `${r.emisor}: ${plural(r.sinConciliar, 'línea')} sin conciliar de ${r.lineas}`
                : `${r.emisor}: ${r.lineas} líneas, todas resueltas`,
        href: `${base}/resumenes/${r.id}`,
        tono: r.estado === 'ERROR_PROCESAMIENTO' || r.sinConciliar ? ('aviso' as const) : ('ok' as const),
      }))
    : [{ texto: 'No hay resúmenes de tarjeta o banco cargados para este mes', href: `${base}/resumenes`, tono: 'aviso' }];

  const a = e.arca;
  const itemsArca: Item[] = !a.conectado
    ? [{ texto: 'ARCA no está conectado para esta empresa', href: `${base}/arca`, tono: 'info' }]
    : [
        a.faltantes
          ? { texto: `${plural(a.faltantes, 'comprobante')} en ARCA que no están en PNL`, href: `${base}/arca?mes=${anio}-${mm}&estado=faltantes`, tono: 'aviso' }
          : { texto: 'Todo lo de ARCA está en PNL (o ignorado)', href: `${base}/arca?mes=${anio}-${mm}`, tono: 'ok' },
        a.noFiguranEnArca
          ? { texto: `${plural(a.noFiguranEnArca, 'comprobante')} con CAE sin validar en ARCA`, href: `${base}/comprobantes?lado=todos&${rango}&problema=arca`, tono: 'aviso' }
          : { texto: 'Todos los comprobantes con CAE figuran en ARCA', tono: 'ok' },
      ];

  const s = e.sueldos;
  const itemsSueldos: Item[] = !s.hayEmpleados
    ? [{ texto: 'Sin empleados cargados', tono: 'info' }]
    : [
        ...(s.pendientes ? [{ texto: `${plural(s.pendientes, 'recibo')} de sueldo pendiente${s.pendientes === 1 ? '' : 's'} de revisión`, href: `${base}/empleados?vista=pendientes`, tono: 'aviso' as const }] : []),
        ...(s.sinRecibo ? [{ texto: `${plural(s.sinRecibo, 'empleado')} activo${s.sinRecibo === 1 ? '' : 's'} sin recibo en el mes`, href: `${base}/empleados?vista=detalle&anio=${anio}&mes=${mes}`, tono: 'aviso' as const }] : []),
      ];
  if (s.hayEmpleados && !itemsSueldos.length) {
    itemsSueldos.push({ texto: 'Recibos del mes cargados y confirmados', href: `${base}/empleados?vista=detalle&anio=${anio}&mes=${mes}`, tono: 'ok' });
  }

  const secciones: { titulo: string; nota?: string; items: Item[] }[] = [
    { titulo: 'Comprobantes', nota: 'Lo que está en rojo impide cerrar el mes.', items: itemsComprobantes },
    { titulo: 'Resúmenes de tarjeta y banco', items: itemsResumenes },
    { titulo: 'ARCA', items: itemsArca },
    { titulo: 'Sueldos', items: itemsSueldos },
  ];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`${base}/periodos?ejercicio=${ejercicio}`} className="text-sm text-slate-500 underline">← Períodos</Link>
        <h1 className="text-lg font-semibold">{MES_LABEL[mes]} {anio}</h1>
        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cerrado ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800'}`}>
          {cerrado ? 'CERRADO' : 'ABIERTO'}
        </span>
      </div>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      {cerrado ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Mes cerrado{periodo?.cerradoAt ? ` el ${formatFechaHora(periodo.cerradoAt)}` : ''}
          {cerradoPor ? ` por ${cerradoPor.usuario.nombre || cerradoPor.usuario.email}` : ''}.
        </div>
      ) : e.bloqueantes > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          No se puede cerrar todavía: {plural(e.bloqueantes, 'comprobante')} sin resolver.
          {e.advertencias > 0 && ` Además hay ${plural(e.advertencias, 'tema')} para revisar.`}
        </div>
      ) : (
        <div className={`rounded-md border px-3 py-2 text-sm ${e.advertencias ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {e.advertencias
            ? `Listo para cerrar. Hay ${plural(e.advertencias, 'tema')} para revisar (no impiden el cierre).`
            : '✓ Listo para cerrar: no queda nada pendiente.'}
        </div>
      )}

      {secciones.map((sec) => (
        <section key={sec.titulo} className="card p-3 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">{sec.titulo}</h2>
            {sec.nota && <span className="text-xs text-slate-400">{sec.nota}</span>}
          </div>
          <ul className="space-y-1 text-sm">
            {sec.items.map((it, i) => (
              <li key={i} className={`flex gap-2 ${TONO[it.tono]}`}>
                <span className="w-4 shrink-0">{it.tono === 'ok' ? '✓' : it.tono === 'info' ? '·' : it.tono === 'bloquea' ? '✕' : '⚠'}</span>
                {it.href ? <Link href={it.href} className="underline underline-offset-2">{it.texto}</Link> : <span>{it.texto}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="card p-3">
        {!cerrado ? (
          <form action={cerrarPeriodoAction} className="flex items-center gap-3 flex-wrap">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="anio" value={anio} />
            <input type="hidden" name="mes" value={mes} />
            <button className="btn-primary" disabled={e.bloqueantes > 0}>Cerrar {MES_LABEL[mes]} {anio}</button>
            <span className="text-xs text-slate-500">
              {e.bloqueantes > 0
                ? 'Resolvé los comprobantes en rojo para poder cerrar.'
                : 'Cerrar congela el mes: no se pueden crear, validar, editar ni anular movimientos con fecha en él.'}
            </span>
          </form>
        ) : esAdmin ? (
          <form action={reabrirPeriodoAction} className="flex items-center gap-2 flex-wrap">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="anio" value={anio} />
            <input type="hidden" name="mes" value={mes} />
            <input name="motivo" required placeholder="Motivo de la reapertura (obligatorio)" className="input !w-72 text-sm" />
            <button className="btn-danger text-sm">Reabrir</button>
          </form>
        ) : (
          <p className="text-xs text-slate-500">Sólo un administrador puede reabrir el mes.</p>
        )}
      </div>
    </div>
  );
}
