import Link from 'next/link';
import { requireReportePage } from '@/lib/reportes-personalizados/acceso';
import { reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { agruparDesglose, desglosarCentro, type FilaDesglose, type SeccionDesglose } from '@/lib/reportes-personalizados/desglose-centro';
import { cargarDatosPnl, prorrateosDelPnl } from '@/lib/reportes/datos-pnl';
import { armarPnl } from '@/lib/reportes/pnl';
import { CRITERIO_LABEL, type CriterioProrrateo } from '@/lib/reportes/prorrateo';
import { MES_LABEL, ejercicioDeMes, mesesDeEjercicio, periodoAnterior, periodoDeFecha } from '@/lib/periodos';
import { PageHeader } from '@/components/page-header';
import { formatMoneyFirmado } from '@/lib/format';

// Reporte personalizado "Desglose Shared Services": el listado itemizado que
// explica, al centavo, la vista del Reporte P&L por un centro de costo (por
// defecto Shared Services): cada comprobante/recibo con el % que le toca al
// centro y los prorrateos recibidos consolidados. Cálculo en
// lib/reportes-personalizados/desglose-centro.ts.

const ID = 'desglose-shared-services';

const SECCION_LABEL: Record<SeccionDesglose, string> = {
  INGRESOS: 'Ingresos',
  EGRESOS: 'Egresos operativos',
  PERSONAL: 'Costos de personal',
  SIN_CATEGORIA: 'Sin categoría (revisar)',
};
const ORIGEN_LABEL: Record<string, string> = {
  ASIENTO_MANUAL: 'Asiento manual',
  VENTA_MANUAL: 'Venta manual',
  RESUMEN: 'Resumen',
};

const pct = (p: number) => `${p.toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`;
const fmtDriver = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const mesCorto = (m: { anio: number; mes: number }) => `${MES_LABEL[m.mes].slice(0, 3).toLowerCase()} ${String(m.anio).slice(2)}`;
const Monto = ({ c, className = '' }: { c: number; className?: string }) => (
  <span className={`${c < 0 ? 'text-red-700' : ''} ${className}`}>{formatMoneyFirmado(c)}</span>
);

export default async function DesgloseSharedServicesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { centro?: string; ejercicio?: string; mes?: string };
}) {
  const ctx = await requireReportePage(params.empresaSlug, ID);
  const reporte = reporteDelCatalogo(ID)!;
  const base = `/${params.empresaSlug}`;
  const inicio = ctx.empresa.inicioEjercicioFiscal;

  // Período: un mes del ejercicio o el ejercicio completo (mes=todos). Por
  // defecto, el mes anterior al actual (el último cerrado).
  const anterior = periodoAnterior(periodoDeFecha(new Date()).anio, periodoDeFecha(new Date()).mes);
  const ejercicio = Number(searchParams.ejercicio) || ejercicioDeMes(anterior.anio, anterior.mes, inicio);
  const mesesEjercicio = mesesDeEjercicio(ejercicio, inicio);
  const mesParam = searchParams.mes ?? (searchParams.ejercicio ? 'todos' : `${anterior.anio}-${anterior.mes}`);
  const mesElegido = mesesEjercicio.find((m) => `${m.anio}-${m.mes}` === mesParam);
  const meses = mesElegido ? [mesElegido] : mesesEjercicio;

  const [centros, categorias] = await Promise.all([
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
  ]);
  const centro =
    centros.find((c) => c.id === searchParams.centro) ??
    centros.find((c) => c.activo && /shared/i.test(c.nombre)) ??
    centros.find((c) => c.activo) ??
    centros[0];

  const selector = (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      <label className="text-xs text-ink-mute" htmlFor="centro">Centro de costo</label>
      <select key={`c${centro?.id}`} id="centro" name="centro" defaultValue={centro?.id} className="input w-auto text-sm">
        {centros.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (inactivo)'}</option>
        ))}
      </select>
      <label className="ml-2 text-xs text-ink-mute" htmlFor="ejercicio">Ejercicio</label>
      <input key={`e${ejercicio}`} id="ejercicio" name="ejercicio" type="number" defaultValue={ejercicio} className="input w-24 text-sm" />
      <label className="ml-2 text-xs text-ink-mute" htmlFor="mes">Período</label>
      <select key={`m${mesParam}`} id="mes" name="mes" defaultValue={mesElegido ? mesParam : 'todos'} className="input w-auto text-sm">
        <option value="todos">Ejercicio completo</option>
        {mesesEjercicio.map((m) => (
          <option key={`${m.anio}-${m.mes}`} value={`${m.anio}-${m.mes}`}>{MES_LABEL[m.mes]} {m.anio}</option>
        ))}
      </select>
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

  const datos = await cargarDatosPnl(ctx.db, meses);
  const conProrrateo = await prorrateosDelPnl(ctx.db, meses, centros.map((c) => ({ id: c.id, prorrateo: c.prorrateo })), datos);
  const d = desglosarCentro({
    meses,
    centroId: centro.id,
    movimientos: datos.movimientosPnl,
    recibos: datos.recibosPnl,
    prorrateos: conProrrateo?.prorrateos,
    resultadoEmisor: conProrrateo?.resultadoEmisor,
  });
  // Control: el mismo P&L filtrado que muestra el Reporte P&L.
  const pnl = armarPnl({ meses, movimientos: datos.movimientosPnl, recibos: datos.recibosPnl, filtro: { campo: 'centroCostoId', valor: centro.id } });
  const suma = (v: number[]) => v.reduce((a, x) => a + x, 0);
  const totalAntes = suma(d.resultadoAntes);
  const totalDespues = suma(d.resultadoDespues);
  const diferencia = suma(pnl.resultado) - totalAntes;

  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  // Mismo orden que el P&L: padres y sus hijas.
  const ordenCategorias = categorias
    .filter((c) => !c.padreId)
    .flatMap((p) => [p.id, ...categorias.filter((h) => h.padreId === p.id).map((h) => h.id)]);
  const secciones = agruparDesglose(d.filas, ordenCategorias);

  const movPorId = new Map(datos.movimientos.map((m) => [m.id, m]));
  const recPorId = new Map(datos.recibos.map((r) => [r.id, r]));
  const describir = (f: FilaDesglose) => {
    if (f.tipo === 'RECIBO') {
      const r = recPorId.get(f.id)!;
      return {
        documento: r.tipo === 'MENSUAL' ? 'Recibo de sueldo' : `Recibo ${r.tipo.toLowerCase().replace(/_/g, ' ')}`,
        concepto: r.empleado.nombre,
        href: `${base}/empleados/recibos/${r.id}`,
      };
    }
    const m = movPorId.get(f.id)!;
    const numero = [m.puntoVenta, m.numero].filter(Boolean).join('-');
    return {
      documento: [m.tipoComprobante?.replace(/_/g, ' '), numero].filter(Boolean).join(' ') || ORIGEN_LABEL[m.origen] || 'Movimiento',
      concepto: m.contraparte?.razonSocial ?? m.descripcion ?? '—',
      detalle: m.contraparte && m.descripcion ? m.descripcion : undefined,
      href: `${base}/validacion/${m.id}`,
    };
  };
  const linkPnl = `${base}/reportes?ejercicio=${ejercicio}&vista=cc:${centro.id}`;
  const periodoTexto = mesElegido ? `${MES_LABEL[mesElegido.mes]} ${mesElegido.anio}` : `ejercicio ${ejercicio}/${ejercicio + 1}`;
  const conProrrateos = d.recibidos.length > 0 || d.repartido.length > 0;

  return (
    <div>
      <PageHeader
        titulo={`${reporte.titulo} — ${centro.nombre}`}
        descripcion={`Lo que compone el resultado de ${centro.nombre} en el Reporte P&L (${periodoTexto}), a valores netos y en pesos.`}
        acciones={
          <>
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
                      titulo={g.categoriaId ? nombreCat.get(g.categoriaId) ?? '?' : 'Sueldos y cargas (recibos)'}
                      subtotal={g.subtotal}
                      cantidad={g.filas.length}
                    >
                      {g.filas.map((f) => {
                        const x = describir(f);
                        const repartido = f.otrosCentros.length > 0;
                        return (
                          <tr key={`${f.tipo}-${f.id}`} className="hover:bg-slate-50">
                            <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(f.mes)}</td>
                            <td className="whitespace-nowrap">
                              <Link href={x.href} className="underline-offset-2 hover:underline">{x.documento}</Link>
                            </td>
                            <td>
                              {x.concepto}
                              {'detalle' in x && x.detalle && <span className="block text-[11px] text-ink-mute">{x.detalle}</span>}
                            </td>
                            <td className="num whitespace-nowrap"><Monto c={f.neto} className={repartido ? '' : 'text-ink-mute'} /></td>
                            <td
                              className={`num whitespace-nowrap ${repartido ? 'font-medium' : 'text-ink-mute'}`}
                              title={repartido ? `Resto: ${f.otrosCentros.map((o) => `${nombreCentro.get(o.centroCostoId) ?? '?'} ${pct(o.porcentaje)}`).join(' · ')}` : undefined}
                            >
                              {pct(f.porcentaje)}
                              {repartido && (
                                <span className="block text-[11px] font-normal text-ink-mute">
                                  resto: {f.otrosCentros.map((o) => `${nombreCentro.get(o.centroCostoId) ?? '?'} ${pct(o.porcentaje)}`).join(', ')}
                                </span>
                              )}
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
                      {centro.prorrateo ? 'Prorrateo de este centro' : 'Prorrateos recibidos'}
                    </td>
                  </tr>
                  {d.recibidos.map((r) => {
                    const emisor = centros.find((c) => c.id === r.emisorId);
                    const criterio = emisor?.prorrateo as CriterioProrrateo;
                    const fraccion = r.totalDriver > 0 ? r.driver / r.totalDriver : 0;
                    return (
                      <tr key={`${r.emisorId}-${r.mes.anio}-${r.mes.mes}`} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(r.mes)}</td>
                        <td className="whitespace-nowrap">
                          <Link href={`${base}/reportes?ejercicio=${ejercicio}&vista=cc:${r.emisorId}`} className="underline-offset-2 hover:underline">
                            {emisor?.nombre ?? '?'}
                          </Link>
                        </td>
                        <td>
                          Prorrateo por {CRITERIO_LABEL[criterio]}
                          <span className="block text-[11px] text-ink-mute">
                            {criterio === 'HEADCOUNT'
                              ? `${fmtDriver(r.driver)} de ${fmtDriver(r.totalDriver)} cabezas`
                              : `${formatMoneyFirmado(r.driver)} de ${formatMoneyFirmado(r.totalDriver)} facturados`}
                          </span>
                        </td>
                        <td className="num whitespace-nowrap" title={`Resultado de ${emisor?.nombre ?? '?'} del mes`}><Monto c={r.resultadoEmisor} /></td>
                        <td className="num whitespace-nowrap font-medium">{pct(Math.round(fraccion * 1000000) / 10000)}</td>
                        <td className="num whitespace-nowrap"><Monto c={r.importe} /></td>
                      </tr>
                    );
                  })}
                  {d.repartido.map((r) => (
                    <tr key={`rep-${r.mes.anio}-${r.mes.mes}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap pl-8 text-ink-mute">{mesCorto(r.mes)}</td>
                      <td colSpan={4}>
                        Repartido a otros centros · por {CRITERIO_LABEL[centro.prorrateo as CriterioProrrateo]}
                        {r.sinBase && (
                          <span className="block text-[11px] text-amber-700">
                            Sin base de prorrateo: ningún centro receptor tiene driver este mes; el resultado queda en este centro.
                          </span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap">{r.sinBase ? <span className="text-amber-700">sin base</span> : <Monto c={r.importe} />}</td>
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
          repartido entre centros, debajo figura el resto. Los prorrateos van consolidados: una línea por centro emisor y mes,
          con su driver.
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
