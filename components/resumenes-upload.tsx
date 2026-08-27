'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subirResumenAction } from '@/app/(app)/[empresaSlug]/resumenes/actions';

// Carga de un resumen de tarjeta/banco: calco de RecibosUpload, con el tipo y
// el emisor cargados antes de elegir el PDF (el pipeline los necesita para
// crear el registro Resumen).
export function ResumenesUpload({ empresaSlug }: { empresaSlug: string }) {
  const [tipo, setTipo] = useState<'TARJETA' | 'BANCO'>('TARJETA');
  const [emisor, setEmisor] = useState('');
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subiendo, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function enviar(file: File) {
    if (!emisor.trim()) {
      setMensaje({ ok: false, texto: 'Indicá el banco/tarjeta emisor antes de subir el PDF.' });
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('empresaSlug', empresaSlug);
      fd.set('tipo', tipo);
      fd.set('emisor', emisor.trim());
      fd.set('archivo', file);
      const r = await subirResumenAction(fd);
      setMensaje(
        r.ok
          ? { ok: true, texto: 'PDF recibido: encolado para extracción. El worker lo está procesando.' }
          : { ok: false, texto: r.error ?? 'Error inesperado' },
      );
      if (r.ok) setEmisor('');
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className="block text-xs text-slate-500 mb-1">Tipo</label>
        <select
          className="input text-sm"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as 'TARJETA' | 'BANCO')}
          disabled={subiendo}
        >
          <option value="TARJETA">Tarjeta</option>
          <option value="BANCO">Banco</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Emisor</label>
        <input
          type="text"
          className="input text-sm"
          placeholder="VISA Santander, Cuenta Frances…"
          value={emisor}
          onChange={(e) => setEmisor(e.target.value)}
          disabled={subiendo}
        />
      </div>
      <div>
        <button type="button" className="btn-primary" disabled={subiendo} onClick={() => inputRef.current?.click()}>
          {subiendo ? 'Subiendo…' : 'Subir resumen (PDF)'}
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
      </div>
      {mensaje && (
        <p className={`text-sm w-full ${mensaje.ok ? 'text-accent-strong' : 'text-red-600'}`}>{mensaje.texto}</p>
      )}
    </div>
  );
}
