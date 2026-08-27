'use client';

import { useState } from 'react';
import type { OcrParaRegla } from '@/lib/reglas/ocr-para-regla';

// Pop-up con lo que leyó el OCR, para elegir la palabra clave de una regla sin
// adivinar: click en una palabra (o seleccionar texto y "Usar selección") la
// pone en el input de palabra clave del formulario que lo contiene. Todos los
// botones son type="button": vive dentro del <form> de validar/asignar.

export function OcrPopup({ ocr, inputId = 'reglaPalabraClave' }: { ocr: OcrParaRegla; inputId?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [elegida, setElegida] = useState('');

  const usar = (texto: string) => {
    const t = texto.trim();
    if (!t) return;
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (el) {
      el.value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setElegida(t);
  };
  const usarSeleccion = () => usar(window.getSelection()?.toString() ?? '');

  const palabras = Array.from(
    new Set(
      ocr.textoMatching
        .split(/\s+/)
        .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter((p) => p.length >= 3),
    ),
  );

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="text-xs text-sky-700 underline">
        Ver lo que leyó el OCR
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAbierto(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">Lo que leyó el OCR</p>
              <button type="button" onClick={() => setAbierto(false)} className="text-xs text-slate-500 underline">Cerrar ✕</button>
            </div>

            <div className="rounded border border-sky-200 bg-sky-50/50 p-3 space-y-2">
              <p className="text-xs font-semibold text-sky-800">
                Texto donde la regla busca la palabra clave (razón social + descripción)
              </p>
              <p className="text-slate-700 select-text">{ocr.textoMatching || '—'}</p>
              {palabras.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {palabras.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => usar(p)}
                      className={`rounded-full border px-2 py-0.5 text-xs hover:bg-sky-100 ${
                        elegida === p ? 'border-sky-600 bg-sky-100 text-sky-900' : 'border-slate-300 text-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Click en una palabra para usarla, o seleccioná una frase con el mouse y apretá «Usar selección».
              </p>
            </div>

            {ocr.campos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">Campos extraídos (click en un valor para usarlo)</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {ocr.campos.map((c) => (
                    <div key={c.label} className="contents">
                      <dt className="text-xs text-slate-500 whitespace-nowrap pt-0.5">{c.label}</dt>
                      <dd>
                        <button
                          type="button"
                          onClick={() => usar(c.valor)}
                          className="text-left text-slate-700 hover:underline select-text"
                          title="Usar como palabra clave"
                        >
                          {c.valor}
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap border-t border-slate-100 pt-3">
              <button type="button" onClick={usarSeleccion} className="btn-secondary text-xs">Usar selección</button>
              {elegida && (
                <span className="text-xs text-slate-600">
                  Palabra clave: <strong>{elegida}</strong>
                </span>
              )}
              <button type="button" onClick={() => setAbierto(false)} className="btn-primary text-xs ml-auto">Listo</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
