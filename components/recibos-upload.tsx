'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subirRecibosAction } from '@/app/(app)/[empresaSlug]/empleados/actions';

// Carga de recibos de sueldo: calco de UploadZone simplificado a un solo
// archivo PDF (multi-recibo, se separa en páginas en el pipeline).
export function RecibosUpload({ empresaSlug }: { empresaSlug: string }) {
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subiendo, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function enviar(file: File) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('empresaSlug', empresaSlug);
      fd.set('archivo', file);
      const r = await subirRecibosAction(fd);
      setMensaje(
        r.ok
          ? { ok: true, texto: `PDF recibido: ${r.paginas} página${r.paginas !== 1 ? 's' : ''} encoladas. El worker las está procesando.` }
          : { ok: false, texto: r.error ?? 'Error inesperado' },
      );
      router.refresh();
    });
  }

  return (
    <div>
      <button type="button" className="btn-primary" disabled={subiendo} onClick={() => inputRef.current?.click()}>
        {subiendo ? 'Subiendo…' : 'Subir recibos (PDF)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) enviar(f);
          e.target.value = '';
        }}
      />
      {mensaje && <p className={`mt-2 text-sm ${mensaje.ok ? 'text-accent-strong' : 'text-red-600'}`}>{mensaje.texto}</p>}
    </div>
  );
}
