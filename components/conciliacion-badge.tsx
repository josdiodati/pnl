'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Conciliacion } from '@/lib/resumenes/conciliacion-comprobante';

// Tag «Conciliado» de un comprobante (como QR/ARCA: el texto es fijo, el
// color dice el grado): verde = las líneas de resumen cubren el total,
// amarillo = parcial, rojo = no aparece en ningún resumen. Con líneas, el
// click abre la lista de las líneas exactas con link a cada una.

const ESTILO = {
  COMPLETA: ['bg-accent-soft text-accent-strong', 'Conciliado con resúmenes: cubre el total'],
  PARCIAL: ['bg-amber-100 text-amber-800', 'Conciliado en parte: las líneas de resumen no cubren el total'],
  NINGUNA: ['bg-red-100 text-red-700', 'No aparece en ningún resumen'],
} as const;

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const importe = (moneda: string, n: number) => `${moneda === 'ARS' ? '$' : moneda} ${fmt(n)}`;
const fecha = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '—';

/** Lista de las líneas que pagaron el comprobante (popover del tag y bloque del detalle). */
export function LineasConciliacion({ c, empresaSlug }: { c: Conciliacion; empresaSlug: string }) {
  return (
    <div className="space-y-1.5">
      {c.lineas.map((l) => (
        <Link
          key={l.id}
          href={`/${empresaSlug}/resumenes/${l.resumenId}?linea=${l.id}`}
          className="block rounded px-2 py-1 hover:bg-slate-50"
        >
          <span className="block text-[11px] text-slate-500">{l.resumen}</span>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-800">
              {fecha(l.fecha)} · {l.descriptor}
              {l.cuotas && <span className="ml-1 text-[11px] text-slate-500">cuota {l.cuotas}</span>}
            </span>
            <span className="text-xs tabular-nums whitespace-nowrap text-slate-700">
              {l.monto != null ? importe('ARS', Math.abs(l.monto)) : l.montoOrigen != null ? importe(l.moneda, Math.abs(l.montoOrigen)) : '—'}
            </span>
          </span>
        </Link>
      ))}
      {c.grado === 'PARCIAL' && c.faltante != null && (
        <p className="px-2 text-[11px] text-amber-800">
          Cubierto {importe(c.moneda, c.cubierto ?? 0)} · falta {importe(c.moneda, c.faltante)}
        </p>
      )}
    </div>
  );
}

export function ConciliacionBadge({ c, empresaSlug }: { c: Conciliacion; empresaSlug: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const [clase, titulo] = ESTILO[c.grado];
  const chip = `inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${clase}`;
  if (c.grado === 'NINGUNA') return <span title={titulo} className={chip}>Conciliado</span>;
  return (
    <details ref={ref} open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)} className="relative inline-block">
      <summary title={`${titulo} — click para ver las líneas`} className={`${chip} list-none cursor-pointer select-none`}>
        Conciliado
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-80 rounded border border-slate-200 bg-white p-1 shadow-lg">
        <p className="px-2 py-1 text-[11px] font-semibold text-slate-500">{titulo}</p>
        <LineasConciliacion c={c} empresaSlug={empresaSlug} />
      </div>
    </details>
  );
}
