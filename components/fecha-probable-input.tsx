'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fijarFechaProbableAction } from '@/app/(app)/[empresaSlug]/ventas/actions';

// Fecha probable de cobro editable en la celda: al cambiarla queda "fijada a
// mano" (pisa vencimiento, plazo e histórico); la × vuelve a la derivada.
export function FechaProbableInput({
  slug,
  ventaId,
  fechaIso,
  fuente,
  manual,
  editable,
}: {
  slug: string;
  ventaId: string;
  fechaIso: string;
  fuente: string;
  manual: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const guardar = (valor: string | null) =>
    startTransition(async () => {
      const r = await fijarFechaProbableAction(slug, ventaId, valor);
      setError(r.error ?? null);
      router.refresh();
    });

  if (!editable) {
    return (
      <span className="font-mono text-[12px]" title={`Fecha probable: ${fuente}`}>
        {fechaIso ? fechaIso.split('-').reverse().join('/') : '—'}
      </span>
    );
  }
  return (
    <span className={`inline-flex flex-col ${pendiente ? 'opacity-50' : ''}`}>
      <span className="inline-flex items-center gap-1">
        <input
          type="date"
          defaultValue={fechaIso}
          key={fechaIso}
          disabled={pendiente}
          onChange={(e) => e.target.value && guardar(e.target.value)}
          className="rounded border border-transparent bg-transparent px-1 font-mono text-[12px] hover:border-line focus:border-accent focus:outline-none"
          aria-label="Fecha probable de cobro"
          title="Fecha probable de cobro: cambiala para fijarla a mano"
        />
        {manual && (
          <button type="button" onClick={() => guardar(null)} className="text-[11px] text-ink-mute hover:text-tinta" title="Volver a la fecha calculada">
            ×
          </button>
        )}
      </span>
      <span className="pl-1 text-[10px] text-ink-mute">{fuente}</span>
      {error && <span className="pl-1 text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
