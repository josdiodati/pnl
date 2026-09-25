'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mensajeSinRespuesta, mensajeErrorEnvio } from '@/lib/carga/subir-en-tandas';
import { postArchivos } from '@/lib/subidas/cliente';

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
      // Sin respuesta (rechazo delante de la app): error legible, no crash.
      let r: { ok?: boolean; paginas?: number; error?: string };
      try {
        r = (await postArchivos<{ ok?: boolean; paginas?: number; error?: string }>(`/${empresaSlug}/empleados/recibos/subir`, fd))
          ?? { ok: false, error: mensajeSinRespuesta([file.name]) };
      } catch (err) {
        r = { ok: false, error: mensajeErrorEnvio([file.name], err) };
      }
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
