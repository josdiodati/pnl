'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subirResumenAction, type SubirResumenesResultado } from '@/app/(app)/[empresaSlug]/resumenes/actions';

// Carga de resúmenes de tarjeta/banco: varios PDFs de una, sin declarar tipo
// ni emisor (los declara el propio PDF y los completa la extracción). Se manda
// un PDF por request: los resúmenes pesan y el límite es 15 MB cada uno.
export function ResumenesUpload({ empresaSlug }: { empresaSlug: string }) {
  const [resultado, setResultado] = useState<SubirResumenesResultado | null>(null);
  const [subiendo, startTransition] = useTransition();
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function enviar(files: FileList | File[]) {
    const lista = Array.from(files);
    if (!lista.length) return;
    startTransition(async () => {
      const total: SubirResumenesResultado = { ok: 0, errores: [] };
      setResultado(null);
      setProgreso({ hechos: 0, total: lista.length });
      for (const [i, file] of lista.entries()) {
        const fd = new FormData();
        fd.set('empresaSlug', empresaSlug);
        fd.append('archivos', file);
        const r = await subirResumenAction(fd);
        total.ok += r.ok;
        total.errores.push(...r.errores);
        setProgreso({ hechos: i + 1, total: lista.length });
      }
      setResultado(total);
      setProgreso(null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div>
        <button type="button" className="btn-primary" disabled={subiendo} onClick={() => inputRef.current?.click()}>
          {subiendo ? 'Subiendo…' : 'Subir resúmenes (PDF)'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enviar(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <p className="text-xs text-slate-500">
        Podés elegir varios de una vez. El banco/tarjeta y el período los detecta el propio resumen.
      </p>
      {progreso && (
        <p className="text-sm text-slate-500 w-full tabular-nums">
          Subiendo {progreso.hechos}/{progreso.total}…
        </p>
      )}
      {resultado && (
        <div className="w-full space-y-1">
          {resultado.ok > 0 && (
            <p className="text-sm text-accent-strong">
              {resultado.ok} resumen{resultado.ok !== 1 ? 'es' : ''} en cola de extracción. El worker los está procesando.
            </p>
          )}
          {resultado.errores.map((e, i) => (
            <p key={i} className="text-sm text-red-600">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
