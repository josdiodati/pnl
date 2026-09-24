import type { EstadoCobroVenta } from '@/lib/cobranzas/estado';

// Estado de cobro de una venta. Color sólo para estados (spec UX): verde
// cobrada, ámbar parcial, rojo vencida, neutro pendiente.

export function CobroBadge({ estado, vencida, diasVencida }: { estado: EstadoCobroVenta; vencida: boolean; diasVencida: number }) {
  if (estado === 'NO_APLICA') return <span className="text-ink-mute">—</span>;
  const base = 'inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap';
  if (estado === 'COBRADA') return <span className={`${base} bg-accent-soft text-accent-strong`}>Cobrada</span>;
  const texto = estado === 'PARCIAL' ? 'Parcial' : 'Pendiente';
  if (vencida) {
    return (
      <span className={`${base} bg-red-100 text-red-800`} title={`Fecha probable vencida hace ${diasVencida} días`}>
        {texto} · vencida {diasVencida} d
      </span>
    );
  }
  return <span className={`${base} ${estado === 'PARCIAL' ? 'bg-amber-100 text-amber-800' : 'bg-white border border-line text-ink-mute'}`}>{texto}</span>;
}
