'use client';

import { useEffect, useRef, useState } from 'react';

type Opcion = {
  id: string;
  nombre: string;
  descripcion: string;
  fecha: string;
  monto: string;
  neto: number | null;
  periodo: string | null;
};

const importeAr = (v: number) => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Buscador de comprobantes para vincular a un empleado (ficha): se escribe
// texto (contraparte, descripción, número, CUIT) y se elige uno. Al elegirlo,
// el monto se completa con su neto gravado (editable) y se muestra el período
// en el que computa, que es SIEMPRE el del comprobante. El elegido viaja en
// el hidden `movimientoId` del form del server action.
export function BuscadorComprobanteEmpleado({ empresaSlug }: { empresaSlug: string }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Opcion | null>(null);
  const [monto, setMonto] = useState('');
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (elegido) return;
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/${empresaSlug}/empleados/buscar-comprobantes?${new URLSearchParams({ q: texto })}`);
        if (res.ok) setOpciones(await res.json());
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [texto, elegido, empresaSlug]);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  const elegir = (o: Opcion) => {
    setElegido(o);
    setAbierto(false);
    setMonto(o.neto != null ? importeAr(o.neto) : '');
  };

  return (
    <>
      <div className="grow min-w-64 relative" ref={raiz}>
        <label className="label">Comprobante</label>
        <input type="hidden" name="movimientoId" value={elegido?.id ?? ''} />
        {elegido ? (
          <div className="input flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{elegido.nombre}</span>
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{elegido.monto}</span>
            <span className="text-xs text-slate-500 whitespace-nowrap">{elegido.fecha}</span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              title="Quitar selección"
              onClick={() => { setElegido(null); setTexto(''); setMonto(''); }}
            >
              ✕
            </button>
          </div>
        ) : (
          <input
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
            onFocus={() => setAbierto(true)}
            className="input text-sm"
            placeholder="Buscar por contraparte, descripción, número o CUIT…"
            autoComplete="off"
          />
        )}
        {abierto && !elegido && (
          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
            {buscando && <p className="px-3 py-2 text-xs text-slate-400">Buscando…</p>}
            {!buscando && opciones.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">Sin comprobantes asignados que coincidan.</p>
            )}
            {opciones.map((o) => (
              <button
                key={o.id}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sky-50"
                onClick={() => elegir(o)}
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{o.nombre}</span>
                  {o.descripcion && <span className="block truncate text-xs text-slate-400">{o.descripcion}</span>}
                </span>
                <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{o.monto}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{o.fecha}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="label">Período</label>
        <div className="input text-sm w-36 bg-slate-50 text-slate-600" title="El período del vínculo es siempre el del comprobante">
          {elegido?.periodo ?? '—'}
        </div>
      </div>
      <div>
        <label className="label" title="Por defecto, el neto gravado del comprobante (sin IVA ni percepciones)">Monto vinculado ($)</label>
        <input
          name="monto"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className="input text-sm w-36 tabular-nums"
          placeholder="0,00"
        />
      </div>
      <button className="btn-primary text-sm" disabled={!elegido}>Vincular</button>
    </>
  );
}
