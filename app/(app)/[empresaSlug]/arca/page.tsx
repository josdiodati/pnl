import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { formatMoney, formatFecha, formatFechaHora } from '@/lib/format';
import { formatearCuit } from '@/lib/checks/cuit';
import { rolAlcanza } from '@/lib/roles';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { nombreTipoArca, numeroComprobanteArca, esNotaCreditoArca } from '@/lib/arca/mis-comprobantes/tipos-arca';
import { ventanaSyncDiaria } from '@/lib/arca/mis-comprobantes/service';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { AutoRefresh } from '@/components/auto-refresh';
import { sincronizarArcaAction } from './actions';
import { resumirPorMes } from '@/lib/arca/mis-comprobantes/resumen-mensual';
import { MES_LABEL } from '@/lib/periodos';

// ARCA · Mis Comprobantes: lo que ARCA registra como emitido y recibido por
// la empresa, cruzado contra el libro. Sirve para ver qué falta cargar
// (está en ARCA y no en el libro) y qué no figura (está en el libro con CAE
// y ARCA no lo lista en la ventana sincronizada).
//
// Sin ?mes= la vista es una lista por mes con una barra de cumplimiento
// (cruzados / total), como Resúmenes; cada mes abre el detalle.

const ORIGEN_LABEL = { EMITIDO: 'Emitidos', RECIBIDO: 'Recibidos' } as const;

function mesActualAr(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).format(new Date());
  return p.slice(0, 7);
}

export default async function ArcaPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ok?: string; error?: string; origen?: string; estado?: string; mes?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const base = `/${params.empresaSlug}/arca`;
  const esAdmin = rolAlcanza(ctx.rol, 'ADMINISTRADOR');

  const origen = searchParams.origen === 'EMITIDO' || searchParams.origen === 'RECIBIDO' ? searchParams.origen : undefined;
  const estado = searchParams.estado === 'faltantes' || searchParams.estado === 'cruzados' ? searchParams.estado : 'todos';
  // Sin mes: lista mensual. Con mes (o "todos"): el detalle de comprobantes.
  const vistaLista = !searchParams.mes;
  const mes = /^\d{4}-\d{2}$/.test(searchParams.mes ?? '') ? searchParams.mes! : searchParams.mes === 'todos' ? 'todos' : mesActualAr();
  const [anio, mesNum] = mes === 'todos' ? [0, 0] : mes.split('-').map(Number);
  const rangoMes = mes === 'todos' ? undefined : { gte: new Date(Date.UTC(anio, mesNum - 1, 1)), lt: new Date(Date.UTC(anio, mesNum, 1)) };
  const resumenMensual = vistaLista
    ? resumirPorMes(await ctx.db.comprobanteArca.findMany({ select: { fechaEmision: true, origen: true, movimientoId: true } }))
    : [];

  const [credencial, jobEnCurso, ultimoJob, comprobantes, resumenPorOrigen] = await Promise.all([
    ctx.db.credencialArca.findFirst({ where: {} }),
    prisma.job.findFirst({ where: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: ctx.empresa.id, estado: { in: ['queued', 'processing'] } } }),
    prisma.job.findFirst({ where: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: ctx.empresa.id, estado: { in: ['done', 'failed'] } }, orderBy: { createdAt: 'desc' } }),
    ctx.db.comprobanteArca.findMany({
      where: {
        ...(origen ? { origen } : {}),
        ...(estado === 'faltantes' ? { movimientoId: null } : estado === 'cruzados' ? { movimientoId: { not: null } } : {}),
        ...(rangoMes ? { fechaEmision: rangoMes } : {}),
      },
      include: { movimiento: { select: { id: true, estado: true } } },
      orderBy: [{ fechaEmision: 'desc' }, { puntoVenta: 'asc' }, { numeroDesde: 'asc' }],
      take: 500,
    }),
    ctx.db.comprobanteArca.groupBy({
      by: ['origen'],
      where: { ...(rangoMes ? { fechaEmision: rangoMes } : {}) },
      _count: { _all: true },
    }),
  ]);
  const faltantesPorOrigen = await ctx.db.comprobanteArca.groupBy({
    by: ['origen'],
    where: { movimientoId: null, ...(rangoMes ? { fechaEmision: rangoMes } : {}) },
    _count: { _all: true },
  });
  const cuenta = (o: 'EMITIDO' | 'RECIBIDO', lista: typeof resumenPorOrigen) => lista.find((r) => r.origen === o)?._count._all ?? 0;

  // "No figura en ARCA": comprobantes del libro con CAE dentro de la ventana
  // sincronizada (los últimos 30 días hasta ayer, según la última corrida) sin
  // ningún comprobante de ARCA cruzado.
  const ventana = credencial?.ultimaSyncAt ? ventanaSyncDiaria(credencial.ultimaSyncAt) : null;
  const noFiguran = ventana
    ? await ctx.db.movimiento.findMany({
        where: {
          cae: { not: null },
          estado: { notIn: ['ANULADO', 'DUPLICADO', 'INGRESADO', 'PROCESANDO', 'ERROR_PROCESAMIENTO'] },
          fechaDevengamiento: { gte: ventana.desde, lte: ventana.hasta },
          comprobantesArca: { none: {} },
        },
        include: { contraparte: true },
        orderBy: { fechaDevengamiento: 'desc' },
        take: 200,
      })
    : [];

  const meses: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    meses.push(d.toISOString().slice(0, 7));
  }
  const filtro = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const valores = { origen, estado, mes, ...cambios };
    for (const [k, v] of Object.entries(valores)) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <AutoRefresh activo={Boolean(jobEnCurso)} intervaloMs={5000} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold">ARCA · Mis Comprobantes</h1>
          <p className="text-xs text-slate-500">
            Comprobantes emitidos y recibidos que ARCA registra para {ctx.empresa.razonSocial}, cruzados contra el libro.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form action={sincronizarArcaAction}>
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <button className="btn-primary text-sm" disabled={Boolean(jobEnCurso) || credencial?.estado !== 'OK'} title={credencial?.estado === 'OK' ? 'Entra a ARCA con un único login y baja los últimos 30 días' : 'Primero guardá y probá la Clave Fiscal en Configuración'}>
              {jobEnCurso ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </form>
          {/* Formulario HTML común, no server action: ver lib/subidas/ruta.ts. */}
          <form action={`${base}/importar`} method="post" encType="multipart/form-data" className="flex items-center gap-2">
            <input type="file" name="archivo" accept=".csv,.zip,text/csv,application/zip" required className="text-xs" />
            <button className="btn-secondary text-sm" title="El CSV (o el ZIP tal cual) que baja el botón CSV de Mis Comprobantes">Importar CSV</button>
          </form>
        </div>
      </div>

      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      {!credencial && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Todavía no hay Clave Fiscal cargada para esta empresa.{' '}
          {esAdmin ? (
            <Link href={`/${params.empresaSlug}/config`} className="underline">Cargala en Configuración</Link>
          ) : (
            'Pedile a un administrador que la cargue en Configuración.'
          )}{' '}
          Mientras tanto podés importar el CSV que bajás a mano del portal.
        </div>
      )}
      {credencial?.estado === 'BLOQUEADA' && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">
            Falló el ingreso a ARCA{credencial.ultimoIntentoAt ? ` el ${formatFechaHora(credencial.ultimoIntentoAt)}` : ''}: {credencial.motivoBloqueo}
          </p>
          <p className="text-xs mt-1">
            La sincronización está detenida para no bloquear la Clave Fiscal. Verificá si cambió la clave
            {esAdmin ? <> y volvé a guardarla o probá el ingreso desde <Link href={`/${params.empresaSlug}/config`} className="underline">Configuración</Link></> : ' (lo hace un administrador desde Configuración)'}.
          </p>
        </div>
      )}
      {credencial?.estado === 'SIN_PROBAR' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          La Clave Fiscal está guardada pero todavía no se probó el ingreso.{' '}
          {esAdmin ? <Link href={`/${params.empresaSlug}/config`} className="underline">Probalo en Configuración</Link> : 'Un administrador tiene que probarla en Configuración.'}
        </div>
      )}
      {credencial?.estado === 'OK' && credencial.ultimoErrorSync && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          La última sincronización falló (no es un problema de la clave{credencial.erroresSeguidos > 1 ? `, ${credencial.erroresSeguidos} veces seguidas` : ''}): {credencial.ultimoErrorSync}. Se reintenta en la próxima corrida.
        </div>
      )}
      {jobEnCurso && <p className="text-sm text-amber-600">⏳ Sincronización en curso… (esta página se actualiza sola)</p>}
      {ultimoJob?.estado === 'failed' && !jobEnCurso && (
        <p className="text-xs text-red-600">La última corrida terminó con error: {ultimoJob.error}</p>
      )}

      {vistaLista ? (
        <>
          <div className="card p-4 flex flex-wrap items-center gap-6 text-sm">
            <div>
              <span className="text-xs text-slate-500">Última sincronización</span>
              <div>{credencial?.ultimaSyncAt ? formatFechaHora(credencial.ultimaSyncAt) : '—'}</div>
            </div>
            <div>
              <span className="text-xs text-slate-500">Sync diario</span>
              <div>{credencial?.syncAutomatico && credencial.estado === 'OK' ? '06:30, últimos 30 días' : 'apagado'}</div>
            </div>
            <div>
              <span className="text-xs text-slate-500">Total sin cargar en PNL</span>
              <div className="tabular-nums">
                {resumenMensual.reduce((s, m) => s + m.faltan, 0)} de {resumenMensual.reduce((s, m) => s + m.total, 0)} comprobantes en ARCA
              </div>
            </div>
            <Link href={filtro({ mes: 'todos', estado: 'faltantes' })} className="ml-auto text-xs underline text-slate-600">
              Ver todos los faltantes
            </Link>
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Cumplimiento</th>
                  <th>Emitidos</th>
                  <th>Recibidos</th>
                  <th className="text-right">Faltan en PNL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {resumenMensual.map((m) => {
                  const [a, mm] = m.mes.split('-').map(Number);
                  const barra = (c: { total: number; cruzados: number }, ancho = 'w-16') => (
                    c.total > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className={`${ancho} h-1.5 rounded bg-slate-200 overflow-hidden`}>
                          <div className="h-full bg-accent" style={{ width: `${Math.round((c.cruzados / c.total) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">{c.cruzados}/{c.total}</span>
                      </div>
                    ) : <span className="text-xs text-slate-400">—</span>
                  );
                  return (
                    <tr key={m.mes} className="hover:bg-slate-50">
                      <td className="font-medium whitespace-nowrap">
                        <Link href={filtro({ mes: m.mes, origen: undefined, estado: 'todos' })} className="hover:underline underline-offset-2">
                          {MES_LABEL[mm]} {a}
                        </Link>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-28 h-2 rounded bg-slate-200 overflow-hidden">
                            <div className={`h-full ${m.pct === 100 ? 'bg-accent' : 'bg-accent/80'}`} style={{ width: `${m.pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-600">{m.pct}%</span>
                        </div>
                      </td>
                      <td>
                        <Link href={filtro({ mes: m.mes, origen: 'EMITIDO', estado: 'todos' })}>{barra(m.emitidos)}</Link>
                      </td>
                      <td>
                        <Link href={filtro({ mes: m.mes, origen: 'RECIBIDO', estado: 'todos' })}>{barra(m.recibidos)}</Link>
                      </td>
                      <td className="text-right">
                        {m.faltan > 0 ? (
                          <Link href={filtro({ mes: m.mes, origen: undefined, estado: 'faltantes' })} className="text-red-700 underline tabular-nums">
                            {m.faltan} sin cargar
                          </Link>
                        ) : (
                          <span className="text-xs text-accent-strong">✔ completo</span>
                        )}
                      </td>
                      <td>
                        <Link href={filtro({ mes: m.mes, origen: undefined, estado: 'todos' })} className="btn-secondary text-xs">Abrir</Link>
                      </td>
                    </tr>
                  );
                })}
                {resumenMensual.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 py-8">
                      Todavía no hay datos: sincronizá o importá el CSV de Mis Comprobantes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
      <>
      <Link href={base} className="text-sm text-slate-500 underline">← Todos los meses</Link>
      <div className="card p-4 flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span className="text-xs text-slate-500">Última sincronización</span>
          <div>{credencial?.ultimaSyncAt ? formatFechaHora(credencial.ultimaSyncAt) : '—'}</div>
        </div>
        <div>
          <span className="text-xs text-slate-500">Sync diario</span>
          <div>{credencial?.syncAutomatico && credencial.estado === 'OK' ? '06:30, últimos 30 días' : 'apagado'}</div>
        </div>
        {(['EMITIDO', 'RECIBIDO'] as const).map((o) => (
          <div key={o}>
            <span className="text-xs text-slate-500">{ORIGEN_LABEL[o]} {mes === 'todos' ? '' : `(${mes})`}</span>
            <div className="tabular-nums">
              {cuenta(o, resumenPorOrigen)} en ARCA ·{' '}
              <Link href={filtro({ origen: o, estado: 'faltantes' })} className={cuenta(o, faltantesPorOrigen) > 0 ? 'text-red-700 underline' : 'text-slate-500'}>
                {cuenta(o, faltantesPorOrigen)} sin cargar
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">Mes:</span>
        <select
          className="input !w-auto text-xs"
          defaultValue={mes}
          onChange={undefined}
          name="mes"
          form="filtros"
        >
          {meses.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="todos">todos</option>
        </select>
        <form id="filtros" action={base} method="get" className="contents">
          {origen && <input type="hidden" name="origen" value={origen} />}
          <input type="hidden" name="estado" value={estado} />
          <button className="btn-secondary !py-0.5 !px-2 text-xs">Aplicar</button>
        </form>
        <span className="text-slate-300">|</span>
        {[
          { v: undefined, l: 'Emitidos y recibidos' },
          { v: 'EMITIDO', l: 'Emitidos' },
          { v: 'RECIBIDO', l: 'Recibidos' },
        ].map((o) => (
          <Link key={o.l} href={filtro({ origen: o.v })} className={`rounded px-2 py-0.5 ${origen === o.v ? 'bg-slate-800 text-white' : 'border border-slate-300 text-slate-600'}`}>
            {o.l}
          </Link>
        ))}
        <span className="text-slate-300">|</span>
        {[
          { v: 'todos', l: 'Todos' },
          { v: 'faltantes', l: 'Sin cargar en PNL' },
          { v: 'cruzados', l: 'Cruzados' },
        ].map((e) => (
          <Link key={e.v} href={filtro({ estado: e.v })} className={`rounded px-2 py-0.5 ${estado === e.v ? 'bg-slate-800 text-white' : 'border border-slate-300 text-slate-600'}`}>
            {e.l}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Origen</th>
              <th>Tipo</th>
              <th>Número</th>
              <th>{origen === 'EMITIDO' ? 'Receptor' : origen === 'RECIBIDO' ? 'Emisor' : 'Contraparte'}</th>
              <th className="text-right">Total</th>
              <th>En PNL</th>
            </tr>
          </thead>
          <tbody>
            {comprobantes.map((c) => (
              <tr key={c.id} className={c.movimientoId ? '' : 'bg-red-50/40'}>
                <td className="whitespace-nowrap">{formatFecha(c.fechaEmision)}</td>
                <td className="text-xs">{ORIGEN_LABEL[c.origen].slice(0, -1)}</td>
                <td className="text-xs whitespace-nowrap">{nombreTipoArca(c.tipoComprobante)}</td>
                <td className="tabular-nums whitespace-nowrap">{numeroComprobanteArca(c.puntoVenta, c.numeroDesde)}</td>
                <td>
                  <div className="text-sm">{c.denominacionContraparte ?? <span className="text-slate-400">Sin identificar</span>}</div>
                  {c.nroDocContraparte && <div className="text-xs text-slate-400">{formatearCuit(c.nroDocContraparte)}</div>}
                </td>
                <td className={`num whitespace-nowrap ${esNotaCreditoArca(c.tipoComprobante) ? 'text-red-600' : ''}`}>
                  {c.moneda && c.moneda !== '$' ? `${c.moneda} ` : ''}{formatMoney(c.importeTotal != null ? Number(c.importeTotal) : null)}
                </td>
                <td className="text-xs">
                  {c.movimientoId ? (
                    <Link href={`/${params.empresaSlug}/validacion/${c.movimientoId}`} className="text-emerald-700 underline">
                      ✔ cargado{c.movimiento?.estado ? ` (${c.movimiento.estado.toLowerCase()})` : ''}
                    </Link>
                  ) : (
                    <span className="text-red-700">Falta en PNL</span>
                  )}
                </td>
              </tr>
            ))}
            {comprobantes.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 py-8">
                  {credencial?.ultimaSyncAt || estado !== 'todos' || mes !== mesActualAr()
                    ? 'Sin comprobantes de ARCA con estos filtros.'
                    : 'Todavía no hay datos: sincronizá o importá el CSV de Mis Comprobantes.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {comprobantes.length === 500 && <p className="text-xs text-slate-400 px-3 py-2">Se muestran los primeros 500: acotá por mes u origen.</p>}
      </div>
      </>
      )}

      {ventana && (
        <div className="card p-4 space-y-2">
          <h2 className="font-medium text-sm">
            En PNL pero no en ARCA
            <span className="ml-2 text-xs font-normal text-slate-500">
              comprobantes con CAE del {formatFecha(ventana.desde)} al {formatFecha(ventana.hasta)} que ARCA no listó en la última sincronización
            </span>
          </h2>
          {noFiguran.length === 0 ? (
            <p className="text-xs text-slate-500">Todos los comprobantes con CAE de la ventana figuran en ARCA.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {noFiguran.map((m) => (
                <li key={m.id} className="py-1.5 flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-20">{formatFecha(m.fechaDevengamiento)}</span>
                  <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="flex-1 truncate underline text-sky-700">
                    {nombreContraparte(m).nombre ?? 'Sin identificar'}
                  </Link>
                  <span className="text-xs text-slate-500 whitespace-nowrap">{[m.tipoComprobante, m.puntoVenta, m.numero].filter(Boolean).join(' ')}</span>
                  <span className="num text-xs">{formatMoney(m.total != null ? Number(m.total) : null)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-400">
            Puede ser un comprobante que ARCA todavía no publicó (hasta 24 h de demora), un CAE mal leído por el OCR, o un comprobante que no es de esta empresa.
          </p>
        </div>
      )}
    </div>
  );
}
