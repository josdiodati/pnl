'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { UMBRAL_RETENCION } from '@/lib/cobranzas/reparto';
import { conciliarVentasAction } from '@/app/(app)/[empresaSlug]/resumenes/actions';

// "Cobro de facturas…" en la bandeja del resumen: elegir la o las facturas de
// venta que paga un crédito. Viene pretildada la combinación sugerida y
// filtrado al cliente identificado; la suma en vivo explica qué va a pasar con
// la diferencia (retención, parcial, excedente, ajuste de cambio).

export type FacturaCobrable = {
  id: string;
  etiqueta: string;
  cliente: string;
  fechaIso: string;
  saldo: number;
  moneda: string;
  saldoArs: number | null;
  delCliente: boolean;
  sugerida: boolean;
};

export function CobroFacturasSelector({
  slug,
  resumenId,
  lineaId,
  monto,
  facturas,
  clienteIdentificado,
}: {
  slug: string;
  resumenId: string;
  lineaId: string;
  monto: number;
  facturas: FacturaCobrable[];
  clienteIdentificado: string | null;
}) {
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(facturas.filter((f) => f.sugerida).map((f) => f.id)));
  const [filtro, setFiltro] = useState('');
  const [todas, setTodas] = useState(!clienteIdentificado);

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return facturas.filter(
      (f) => (todas || f.delCliente || f.sugerida || elegidas.has(f.id))
        && (!q || `${f.cliente} ${f.etiqueta}`.toLowerCase().includes(q)),
    );
  }, [facturas, filtro, todas, elegidas]);

  const sel = facturas.filter((f) => elegidas.has(f.id));
  const suma = sel.reduce((s, f) => s + (f.saldoArs ?? 0), 0);
  const hayExtranjera = sel.some((f) => f.moneda !== 'ARS');
  const sinTc = sel.some((f) => f.saldoArs == null);
  const dif = Math.round((suma - monto) * 100) / 100;

  let explicacion: { texto: string; tono: string } | null = null;
  if (sel.length > 0) {
    if (hayExtranjera) {
      explicacion = { texto: 'Moneda extranjera: se toma la cotización implícita del crédito y la diferencia contra el TC de la factura va como ajuste de cambio al P&L.', tono: 'text-ink-mute' };
    } else if (Math.abs(dif) <= 1) {
      explicacion = { texto: 'Coincide con el crédito.', tono: 'text-accent-strong' };
    } else if (dif > 1 && monto >= suma * (1 - UMBRAL_RETENCION)) {
      explicacion = { texto: `Faltan ${formatMoney(dif)}: se cierran como retención sufrida.`, tono: 'text-ink-mute' };
    } else if (dif > 1) {
      explicacion = { texto: `Faltan ${formatMoney(dif)}: las facturas quedan parcialmente cobradas.`, tono: 'text-amber-700' };
    } else {
      explicacion = { texto: `El crédito supera las facturas en ${formatMoney(-dif)}: el excedente queda sin aplicar.`, tono: 'text-amber-700' };
    }
  }

  const alternar = (id: string) =>
    setElegidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <form action={conciliarVentasAction} className="space-y-2">
      <input type="hidden" name="empresaSlug" value={slug} />
      <input type="hidden" name="resumenId" value={resumenId} />
      <input type="hidden" name="lineaId" value={lineaId} />
      {[...elegidas].map((id) => <input key={id} type="hidden" name="ventaId" value={id} />)}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por cliente o número…"
          className="input !w-auto min-w-[14rem] text-xs"
        />
        {clienteIdentificado && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
            Ver facturas de otros clientes (identificado: {clienteIdentificado})
          </label>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="w-6 px-2 py-1"></th>
              <th className="px-2 py-1 text-left">Cliente</th>
              <th className="px-2 py-1 text-left">Factura</th>
              <th className="px-2 py-1 text-left">Emitida</th>
              <th className="px-2 py-1 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id} className={`border-t border-slate-100 cursor-pointer hover:bg-amber-50/50 ${elegidas.has(f.id) ? 'bg-accent-soft/60' : ''}`} onClick={() => alternar(f.id)}>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={elegidas.has(f.id)} onChange={() => alternar(f.id)} onClick={(e) => e.stopPropagation()} aria-label={`Elegir ${f.etiqueta}`} />
                </td>
                <td className="px-2 py-1">
                  {f.cliente}
                  {f.sugerida && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">sugerida</span>}
                </td>
                <td className="px-2 py-1 font-mono whitespace-nowrap">{f.etiqueta}</td>
                <td className="px-2 py-1 font-mono">{f.fechaIso.split('-').reverse().join('/')}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                  {formatMoney(f.saldo)}{f.moneda !== 'ARS' ? ` ${f.moneda}` : ''}
                  {f.moneda !== 'ARS' && f.saldoArs != null && <span className="block text-[10px] text-slate-400">≈ {formatMoney(f.saldoArs)}</span>}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">No hay facturas pendientes{filtro ? ' con ese filtro' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="tabular-nums">
          Elegidas: {sel.length} · {formatMoney(suma)} · crédito {formatMoney(monto)}
        </span>
        {explicacion && <span className={explicacion.tono}>{explicacion.texto}</span>}
        {sinTc && <span className="text-amber-700">Alguna factura en moneda extranjera no tiene TC.</span>}
      </div>
      <button className="btn-primary text-sm" disabled={sel.length === 0}>Conciliar como cobro de {sel.length || ''} factura{sel.length === 1 ? '' : 's'}</button>
    </form>
  );
}
