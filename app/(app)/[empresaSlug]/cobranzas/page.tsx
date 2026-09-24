import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { CobroBadge } from '@/components/cobro-badge';
import { formatMoney, formatFecha } from '@/lib/format';
import { cargarVentasConCobros, calcularInfoCobros, hoyUtc } from '@/lib/cobranzas/query';
import { FUENTE_LABEL } from '@/lib/cobranzas/estado';
import { proyectarCobranzas, TRAMOS_ANTIGUEDAD } from '@/lib/cobranzas/proyeccion';
import { INSTRUMENTO_LABEL } from '@/lib/cobranzas/labels';
import { acreditarChequeAction, rechazarChequeAction } from '../ventas/actions';

// Cobranzas (Spec F): cuánto falta cobrar y cuándo entra. Confirmado = cheques
// en cartera por su fecha de cobro; estimado = saldo de facturas por su fecha
// probable. Es una proyección de caja, no toca el P&L.

// Paleta categórica de referencia (slots 1 y 2), validada sobre la superficie.
const COLOR_CONFIRMADO = '#2a78d6';
const COLOR_ESTIMADO = '#eb6834';

function compacto(n: number): string {
  if (Math.abs(n) >= 1e6) return `$ ${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1e3) return `$ ${(n / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 })} k`;
  return formatMoney(n);
}
const ddmm = (f: Date) => f.toISOString().slice(5, 10).split('-').reverse().join('/');

export default async function CobranzasPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const hoy = hoyUtc();
  const [filas, cheques] = await Promise.all([
    cargarVentasConCobros(ctx.db),
    ctx.db.cobro.findMany({
      where: { estado: 'EN_CARTERA' },
      include: { contraparte: true, aplicaciones: { include: { movimiento: { select: { id: true, numero: true, puntoVenta: true, tipoCambio: true } } } } },
      orderBy: { fechaAcreditacion: 'asc' },
    }),
  ]);
  const info = calcularInfoCobros(filas, hoy);
  const pendientes = filas
    .map((f) => ({ f, i: info.get(f.id)! }))
    .filter(({ i }) => i.estado === 'PENDIENTE' || i.estado === 'PARCIAL')
    .sort((a, b) => (a.i.fechaProbable?.fecha.getTime() ?? 0) - (b.i.fechaProbable?.fecha.getTime() ?? 0));

  const chequesPesos = cheques.map((c) => {
    const tc = c.moneda === 'ARS' ? 1 : Number(c.tipoCambio ?? c.aplicaciones[0]?.movimiento.tipoCambio ?? 0);
    return { c, montoArs: Number(c.monto) * tc };
  });
  const p = proyectarCobranzas({
    hoy,
    ventas: pendientes.map(({ f, i }) => ({
      id: f.id,
      cliente: f.contraparte?.razonSocial ?? 'Sin cliente',
      saldoArs: i.saldoArs,
      fechaProbable: i.fechaProbable?.fecha ?? null,
      diasVencida: i.diasVencida,
    })),
    cheques: chequesPesos.map(({ c, montoArs }) => ({
      id: c.id, cliente: c.contraparte?.razonSocial ?? 'Sin cliente', montoArs, fechaAcreditacion: c.fechaAcreditacion,
    })),
  });
  const maxSemana = Math.max(1, ...p.semanas.map((s) => s.confirmado + s.estimado));
  const base = `/${params.empresaSlug}`;

  return (
    <div>
      <PageHeader
        titulo="Cobranzas"
        descripcion="Lo que falta cobrar y cuándo se espera que entre. Confirmado: cheques en cartera por su fecha de cobro. Estimado: saldo de facturas por su fecha probable (vencimiento, plazo o histórico del cliente). No toca el P&L."
        acciones={<Link href={`${base}/ventas?cobro=pendientes`} className="btn-secondary">Ver facturas por cobrar</Link>}
      />
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="reveal reveal-2 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['A cobrar', p.kpis.aCobrar, 'saldo de facturas sin cheque recibido'],
          ['Vencido', p.kpis.vencido, 'fecha probable ya pasada'],
          ['Cheques en cartera', p.kpis.chequesEnCartera, `${cheques.length} instrumento${cheques.length !== 1 ? 's' : ''}`],
          ['Próximos 30 días', p.kpis.proximos30, 'confirmado + estimado'],
        ].map(([titulo, valor, nota]) => (
          <div key={String(titulo)} className="card p-4">
            <p className="label !mb-0.5">{titulo}</p>
            <p className={`font-mono text-2xl font-semibold tabular-nums ${titulo === 'Vencido' && Number(valor) > 0 ? 'text-red-700' : ''}`}>{formatMoney(Number(valor))}</p>
            <p className="mt-1 text-[11px] text-ink-mute">{nota}</p>
          </div>
        ))}
      </div>
      {p.sinTipoCambio > 0 && (
        <p className="mb-3 text-[12px] text-amber-700">{p.sinTipoCambio} factura{p.sinTipoCambio > 1 ? 's' : ''} en moneda extranjera sin tipo de cambio quedan fuera de los totales.</p>
      )}

      <section className="reveal reveal-3 card mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg">Ingresos esperados por semana</h2>
          <div className="flex gap-4 text-[12px] text-ink-mute">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_CONFIRMADO }} />Confirmado (cheques)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_ESTIMADO }} />Estimado (facturas)</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-[36rem] items-end gap-2 border-b border-line pb-0" style={{ height: '12rem' }} role="img" aria-label="Ingresos esperados por semana: confirmado y estimado">
            {p.semanas.map((s) => {
              const total = s.confirmado + s.estimado;
              const hC = (s.confirmado / maxSemana) * 100;
              const hE = (s.estimado / maxSemana) * 100;
              return (
                <div key={s.desde.toISOString()} className="group relative flex h-full flex-1 flex-col justify-end">
                  {total > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] text-white shadow group-hover:block">
                      {ddmm(s.desde)}–{ddmm(s.hasta)} · {formatMoney(total)}
                      <br />confirmado {formatMoney(s.confirmado)} · estimado {formatMoney(s.estimado)}
                    </div>
                  )}
                  {s.estimado > 0 && <div className="rounded-t-[4px]" style={{ height: `${hE}%`, background: COLOR_ESTIMADO, marginBottom: s.confirmado > 0 ? 2 : 0 }} />}
                  {s.confirmado > 0 && <div className={s.estimado > 0 ? '' : 'rounded-t-[4px]'} style={{ height: `${hC}%`, background: COLOR_CONFIRMADO }} />}
                </div>
              );
            })}
          </div>
          <div className="flex min-w-[36rem] gap-2 pt-1">
            {p.semanas.map((s, k) => (
              <div key={k} className="flex-1 text-center text-[10px] text-ink-mute font-mono">{ddmm(s.desde)}</div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-ink-mute">
          Vencido sin cobrar: <span className="tabular-nums">{formatMoney(p.vencido)}</span>
          {' · '}más allá de 12 semanas: <span className="tabular-nums">{formatMoney(p.despues.confirmado + p.despues.estimado)}</span>
        </p>
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-ink-mute">Ver como tabla</summary>
          <table className="table-base mt-2">
            <thead><tr><th>Semana</th><th className="text-right">Confirmado</th><th className="text-right">Estimado</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {p.semanas.map((s, k) => (
                <tr key={k}>
                  <td className="font-mono">{ddmm(s.desde)}–{ddmm(s.hasta)}</td>
                  <td className="num">{formatMoney(s.confirmado)}</td>
                  <td className="num">{formatMoney(s.estimado)}</td>
                  <td className="num">{formatMoney(s.confirmado + s.estimado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <h2 className="px-4 pt-4 font-display text-lg">Antigüedad por cliente</h2>
          <p className="px-4 text-[12px] text-ink-mute">Días desde la fecha probable de cobro.</p>
          <table className="table-base mt-2">
            <thead>
              <tr><th>Cliente</th>{TRAMOS_ANTIGUEDAD.map((t) => <th key={t} className="text-right">{t}</th>)}<th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {p.antiguedad.map((f) => (
                <tr key={f.cliente}>
                  <td className="font-medium">{f.cliente}</td>
                  {f.tramos.map((v, k) => (
                    <td key={k} className={`num ${k > 0 && v > 0 ? 'text-red-700' : ''}`}>{v > 0 ? compacto(v) : '—'}</td>
                  ))}
                  <td className="num font-medium">{compacto(f.total)}</td>
                </tr>
              ))}
              {p.antiguedad.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-mute">Nada por cobrar.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="px-4 pt-4 font-display text-lg">Cheques en cartera</h2>
          <p className="px-4 text-[12px] text-ink-mute">Se acreditan solos al conciliar el resumen; también se pueden marcar a mano.</p>
          <table className="table-base mt-2">
            <thead><tr><th>Cobro</th><th>Cliente</th><th>Instrumento</th><th className="text-right">Monto</th><th></th></tr></thead>
            <tbody>
              {chequesPesos.map(({ c }) => (
                <tr key={c.id}>
                  <td className="font-mono text-[12.5px]">{formatFecha(c.fechaAcreditacion)}</td>
                  <td>{c.contraparte?.razonSocial ?? '—'}</td>
                  <td className="text-[12px]">{INSTRUMENTO_LABEL[c.instrumento]}{c.numero ? ` ${c.numero}` : ''}{c.banco ? ` · ${c.banco}` : ''}</td>
                  <td className="num">{formatMoney(Number(c.monto))}{c.moneda === 'ARS' ? '' : ` ${c.moneda}`}</td>
                  <td className="text-right whitespace-nowrap">
                    <form action={acreditarChequeAction} className="block">
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="cobroId" value={c.id} />
                      <input type="hidden" name="volver" value="cobranzas" />
                      <button className="text-[12px] underline underline-offset-2 text-accent-strong">Acreditado</button>
                    </form>
                    <form action={rechazarChequeAction} className="block">
                      <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                      <input type="hidden" name="cobroId" value={c.id} />
                      <input type="hidden" name="volver" value="cobranzas" />
                      <button className="text-[12px] underline underline-offset-2 text-red-700">Rechazado</button>
                    </form>
                  </td>
                </tr>
              ))}
              {cheques.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-ink-mute">Sin cheques en cartera.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 font-display text-lg">Facturas por cobrar</h2>
        <table className="table-base mt-2">
          <thead>
            <tr><th>Fecha probable</th><th>Cliente</th><th>Factura</th><th>Emitida</th><th>Estado</th><th className="text-right">Saldo</th><th></th></tr>
          </thead>
          <tbody>
            {pendientes.map(({ f, i }) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap">
                  <span className="font-mono text-[12.5px]">{formatFecha(i.fechaProbable?.fecha)}</span>
                  {i.fechaProbable && <span className="block text-[10px] text-ink-mute">{FUENTE_LABEL[i.fechaProbable.fuente]}</span>}
                </td>
                <td>{f.contraparte?.razonSocial ?? '—'}</td>
                <td className="font-mono text-[12.5px] whitespace-nowrap">{f.tipoComprobante?.replace(/_/g, ' ')} {f.puntoVenta ? `${f.puntoVenta}-` : ''}{f.numero ?? ''}</td>
                <td className="font-mono text-[12.5px]">{formatFecha(f.fechaDevengamiento)}</td>
                <td><CobroBadge estado={i.estado} vencida={i.vencida} diasVencida={i.diasVencida} /></td>
                <td className="num">
                  {formatMoney(i.saldo)}{f.moneda === 'ARS' ? '' : ` ${f.moneda}`}
                  {f.moneda !== 'ARS' && i.saldoArs != null && <span className="block text-[10px] text-ink-mute">≈ {formatMoney(i.saldoArs)}</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`${base}/ventas/${f.id}/cobros?volver=cobranzas`} className="text-[12.5px] underline underline-offset-2 text-accent-strong">Cobros</Link>
                </td>
              </tr>
            ))}
            {pendientes.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-ink-mute">Todas las facturas están cobradas.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
