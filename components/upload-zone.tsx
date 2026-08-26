'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subirComprobantesAction, type SubirResultado } from '@/app/(app)/[empresaSlug]/carga/actions';

// Home upload zone: drag & drop of many files at once (mass upload) plus a
// camera button for phones. Files are sent in small batches so dropping 30
// PDFs doesn't freeze the UI; the queue resolves them asynchronously.

export function UploadZone({ empresaSlug }: { empresaSlug: string }) {
  const [arrastrando, setArrastrando] = useState(false);
  const [resultado, setResultado] = useState<SubirResultado | null>(null);
  const [subiendo, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function enviar(files: FileList | File[], canal: 'WEB' | 'FOTO') {
    const lista = Array.from(files);
    if (!lista.length) return;
    startTransition(async () => {
      const total: SubirResultado = { ok: 0, errores: [] };
      // Batches of 5 keep each request small enough for the action body limit.
      // Un drop = un lote: la primera tanda lo crea (con el total esperado) y
      // las siguientes reusan el loteId que devuelve el server.
      let loteId: string | undefined;
      for (let i = 0; i < lista.length; i += 5) {
        const fd = new FormData();
        fd.set('empresaSlug', empresaSlug);
        fd.set('canal', canal);
        fd.set('totalLote', String(lista.length));
        if (loteId) fd.set('loteId', loteId);
        for (const f of lista.slice(i, i + 5)) fd.append('archivos', f);
        const r = await subirComprobantesAction(fd);
        loteId = loteId ?? r.loteId;
        total.ok += r.ok;
        total.errores.push(...r.errores);
      }
      setResultado(total);
      router.refresh();
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          enviar(e.dataTransfer.files, 'WEB');
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          arrastrando ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface'
        }`}
      >
        <p className="font-display text-xl font-semibold text-ink">
          {subiendo ? 'Subiendo…' : 'Arrastrá tus comprobantes acá'}
        </p>
        <p className="text-sm text-ink-mute mt-1">PDF, JPG, PNG o WEBP · podés soltar muchos a la vez · 1 archivo = 1 comprobante</p>
        <p className="text-sm text-ink-mute/70 mt-1">o hacé click para elegirlos</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) enviar(e.target.files, 'WEB');
          e.target.value = '';
        }}
      />
      <input
        ref={fotoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) enviar(e.target.files, 'FOTO');
          e.target.value = '';
        }}
      />

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => fotoRef.current?.click()} className="btn-secondary" disabled={subiendo}>
          📷 Sacar foto del comprobante
        </button>
        {subiendo && <span className="text-sm text-ink-mute">Procesando archivos…</span>}
      </div>

      {resultado && (
        <div className="mt-3 space-y-1">
          {resultado.ok > 0 && (
            <p className="text-sm text-accent-strong">
              {resultado.ok} comprobante{resultado.ok !== 1 ? 's' : ''} ingresado{resultado.ok !== 1 ? 's' : ''} al pipeline.
              El worker los está procesando.
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
