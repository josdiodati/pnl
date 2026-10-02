import Link from 'next/link';
import { requireReportePage } from '@/lib/reportes-personalizados/acceso';
import { reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { cargarDetalleCc, type ParamsDetalleCc } from '@/lib/reportes-personalizados/detalle-cc-datos';
import { SECCION_LABEL, fraccionPct, mesCorto, textoDriver } from '@/lib/reportes-personalizados/detalle-cc';
import { CRITERIO_LABEL } from '@/lib/reportes/prorrateo';
import { MES_LABEL, ejercicioDeMes } from '@/lib/periodos';
import { PageHeader } from '@/components/page-header';
import { formatMoneyFirmado } from '@/lib/format';

// Reporte personalizado "Detalle CC" (id estable desglose-shared-services,
// nació como "Desglose Shared Services"): el listado itemizado que explica, al
// centavo, la vista del Reporte P&L por un centro de costo (por defecto Shared
// Services) entre dos meses: cada comprobante/recibo con el % que le toca al
// centro y los prorrateos recibidos consolidados. Se exporta a XLSX tal cual.
// Cálculo en lib/reportes-personalizados/desglose-centro.ts.

const ID = 'desglose-shared-services';

const pct = (p: number) => `${p.toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`;
const nombreMes = (clave: string) => {
  const [a, m] = clave.split('-').map(Number);
  return `${MES_LABEL[m]} ${a}`;
};
const Monto = ({ c, className = '' }: { c: number; className?: string }) => (
  <span className={`${c < 0 ? 'text-red-700' : ''} ${className}`}>{formatMoneyFirmado(c)}</span>
);

export default async function DetalleCcPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: ParamsDetalleCc;
}) {
  const ctx = await requireReportePage(params.empresaSlug, ID);
  const reporte = reporteDelCatalogo(ID)!;
  const base = `/${params.empresaSlug}`;
  const r = await cargarDetalleCc(ctx, searchParams);
  const { rango, centros, centro } = r;

  const selector = (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      <label className="text-xs text-ink-mute" htmlFor="centro">Centro de costo</label>
      <select key={`c${centro?.id}`} id="centro" name="centro" defaultValue={centro?.id} className="input w-auto text-sm">
        {centros.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (inactivo)'}</option>
        ))}
      </select>
      <label className="ml-2 text-xs text-ink-mute" htmlFor="desde">Desde</label>
      <input key={`d${rango.desde}`} id="desde" name="desde" type="month" defaultValue={rango.desde} className="input w-auto text-sm" />
      <label className="ml-2 text-xs text-ink-mute" htmlFor="hasta">Hasta</label>
      <input key={`h${rango.hasta}`} id="hasta" name="hasta" type="month" defaultValue={rango.hasta} className="input w-auto text-sm" />
      <button className="btn-secondary text-sm">Ver</button>
    </form>
  );

  if (!centro) {
    return (
      <div>
        <PageHeader titulo={reporte.titulo} descripcion={reporte.descripcion} />
        <p className="card p-4 text-sm text-ink-mute">La empresa no tiene centros de costo.</p>
      </div>
    );
  }

  const { desglose: d, secciones, textos, describir, diferencia } = r;
  const suma = (v: number[]) => v.reduce((a, x) => a + x, 0);
  const totalAntes = suma(d.resultadoAntes);
  const totalDespues = suma(d.resultadoDespues);
  const [anioDesde, mesDesde] = rango.desde.split('-').map(Number);
  const linkPnl = `${base}/reportes?ejercicio=${ejercicioDeMes(anioDesde, mesDesde, ctx.empresa.inicioEjercicioFiscal)}&vista=cc:${centro.id}`;
  const qs = new URLSearchParams({ centro: centro.id, desde: rango.desde, hasta: rango.hasta });
  const periodoTexto = rango.desde === rango.hasta ? nombreMes(rango.desde) : `${nombreMes(rango.desde)} a ${nombreMes(rango.hasta)}`;
  const conProrrateos = d.recibidos.length > 0 || d.repartido.length > 0;

  return (
    <div>
      <PageHeader
        titulo={`${reporte.titulo} — ${centro.nombre}`}
        descripcion={`Lo que compone el resultado de ${centro.nombre} en el Reporte P&L (${periodoTexto}), a valores netos y en pesos.`}
        acciones={
          <>
            <a href={`${base}/reportes-personalizados/${ID}/export?${qs}`} className="btn-secondary">Exportar XLSX</a>
            <Link href={linkPnl} className="btn-secondary">Ver en el P&L</Link>
            <Link href={`${base}/reportes-personalizados`} className="btn-secondary">Reportes Personales</Link>
          </>
        }
      />
      {selector}

      <section className="reveal reveal-2 card overflow-x-auto p-4">
        {d.filas.length === 0 && !conProrrateos ? (
          <p className="text-sm text-ink-mute">No hay movimientos asignados ni recibos confirmados de {centro.nombre} en el período.</p>
        ) : (
          <table className="table-base text-sm">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Documento</th>
                <th>Concepto</th>
                <th className="!text-right">Neto documento</th>
                <th className="!text-right">% aplicado</th>
                <th className="!text-right">Importe al centro</th>
              </tr>
            </thead>
            <tbody>
              {secciones.map((s) => (
                <SeccionFilas key={s.seccion} titulo={SECCION_LABEL[s.seccion]} total={s.total}>
                  {s.grupos.map((g) => (
                    <GrupoFilas
                      key={g.categoriaId ?? 'sueldos'}
                      titulo={g.categoriaId ? textos.nombreCategoria(g.categoriaId) : 'Sueldos y cargas (recibos)'}
                      subtotal={g.subtotal}
                      cantidad={g.filas.length}
                    >
                      {g.filas.map((f) => {
                        const x = describir(f);
                        const resto = f.otrosCentros.map((o) => `${textos.nombreCentro(o.centroCostoId)} ${pct(o.porcentaje)}`).join(', ');
                        return (
                          <tr key={`${f.tipo}-${f.id}`} className="hover:bg-slate-50">
                            <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(f.mes)}</td>
                            <td className="whitespace-nowrap">
                              <Link href={`${base}/${x.ruta}`} className="underline-offset-2 hover:underline">{x.documento}</Link>
                            </td>
                            <td>
                              {x.concepto}
                              {'detalle' in x && x.detalle && <span className="block text-[11px] text-ink-mute">{x.detalle}</span>}
                            </td>
                            <td className="num whitespace-nowrap"><Monto c={f.neto} className={resto ? '' : 'text-ink-mute'} /></td>
                            <td className={`num whitespace-nowrap ${resto ? 'font-medium' : 'text-ink-mute'}`}>
                              {pct(f.porcentaje)}
                              {resto && <span className="block text-[11px] font-normal text-ink-mute">resto: {resto}</span>}
                            </td>
                            <td className="num whitespace-nowrap"><Monto c={f.importe} /></td>
                          </tr>
                        );
                      })}
                    </GrupoFilas>
                  ))}
                </SeccionFilas>
              ))}

              <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                <td colSpan={5}>{conProrrateos ? 'Resultado antes de prorrateos' : 'Resultado del período'}</td>
                <td className="num whitespace-nowrap"><Monto c={totalAntes} /></td>
              </tr>

              {conProrrateos && (
                <>
                  <tr>
                    <td colSpan={6} className="bg-slate-50 font-semibold text-slate-700">
                      {textos.criterioCentro ? 'Prorrateo de este centro' : 'Prorrateos recibidos'}
                    </td>
                  </tr>
                  {d.recibidos.map((p) => {
                    const criterio = textos.criterioDe(p.emisorId);
                    return (
                      <tr key={`${p.emisorId}-${p.mes.anio}-${p.mes.mes}`} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(p.mes)}</td>
                        <td className="whitespace-nowrap">
                          <Link
                            href={`${base}/reportes?ejercicio=${ejercicioDeMes(p.mes.anio, p.mes.mes, ctx.empresa.inicioEjercicioFiscal)}&vista=cc:${p.emisorId}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {textos.nombreCentro(p.emisorId)}
                          </Link>
                        </td>
                        <td>
                          Prorrateo por {criterio ? CRITERIO_LABEL[criterio] : '?'}
                          <span className="block text-[11px] text-ink-mute">{textoDriver(criterio, p.driver, p.totalDriver)}</span>
                        </td>
                        <td className="num whitespace-nowrap" title={`Resultado de ${textos.nombreCentro(p.emisorId)} del mes`}><Monto c={p.resultadoEmisor} /></td>
                        <td className="num whitespace-nowrap font-medium">{pct(fraccionPct(p.driver, p.totalDriver))}</td>
                        <td className="num whitespace-nowrap"><Monto c={p.importe} /></td>
                      </tr>
                    );
                  })}
                  {d.repartido.map((p) => (
                    <tr key={`rep-${p.mes.anio}-${p.mes.mes}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(p.mes)}</td>
                      <td colSpan={4}>
                        Repartido a otros centros{textos.criterioCentro ? ` · por ${CRITERIO_LABEL[textos.criterioCentro]}` : ''}
                        {p.sinBase && (
                          <span className="block text-[11px] text-amber-700">
                            Sin base de prorrateo: ningún centro receptor tiene driver este mes; el resultado queda en este centro.
                          </span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap">{p.sinBase ? <span className="text-amber-700">sin base</span> : <Monto c={p.importe} />}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                    <td colSpan={5}>Resultado después de prorrateos</td>
                    <td className="num whitespace-nowrap"><Monto c={totalDespues} /></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        )}
        <p className={`mt-3 text-[12px] ${diferencia === 0 ? 'text-ink-mute' : 'text-amber-700'}`}>
          {diferencia === 0 ? (
            <>
              ✓ El desglose suma exactamente el resultado de {centro.nombre} en el <Link href={linkPnl} className="underline underline-offset-2">Reporte P&L</Link>.
            </>
          ) : (
            <>
              El desglose difiere del <Link href={linkPnl} className="underline underline-offset-2">Reporte P&L</Link> en {formatMoneyFirmado(diferencia)}: revisar.
            </>
          )}{' '}
          Computan los movimientos ASIGNADOS y los recibos confirmados, a valores netos (sin IVA, percepciones ni tributos) y
          en pesos (moneda extranjera × tipo de cambio; sin TC no computa). Los impuestos indirectos por categoría (ej.
          Sircreb) van al memo del P&L y no figuran. El % aplicado es la parte del documento asignada a este centro; si está
          repartido entre centros, debajo figura el resto (el exportable lleva sólo el % asignado). Los prorrateos van
          consolidados: una línea por centro emisor y mes, con su driver. Rango máximo: 36 meses.
        </p>
      </section>
    </div>
  );
}

function SeccionFilas({ titulo, total, children }: { titulo: string; total: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="bg-slate-50 font-semibold text-slate-700">{titulo}</td>
        <td className="num whitespace-nowrap bg-slate-50 font-semibold"><Monto c={total} /></td>
      </tr>
      {children}
    </>
  );
}

function GrupoFilas({ titulo, subtotal, cantidad, children }: { titulo: string; subtotal: number; cantidad: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-slate-200">
        <td colSpan={5} className="pl-4 font-medium">
          {titulo} <span className="text-[11px] font-normal text-ink-mute">· {cantidad} {cantidad === 1 ? 'ítem' : 'ítems'}</span>
        </td>
        <td className="num whitespace-nowrap font-medium"><Monto c={subtotal} /></td>
      </tr>
      {children}
    </>
  );
}
