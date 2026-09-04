'use client';

import { useEffect, useRef, useState } from 'react';

type Opcion = { id: string; nombre: string; descripcion: string; fecha: string; monto: string };

// Buscador con autocompletado para el panel de conciliación: se escribe texto
// (contraparte, descripción, número, CUIT) y se elige un movimiento de los
// resultados. El elegido queda en un hidden `movimientoId` dentro del form del
// server action; hasta que no hay elección, el botón Conciliar va deshabilitado.
export function BuscadorMovimiento({ empresaSlug }: { empresaSlug: string }) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Opcion | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (elegido) return;
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/${empresaSlug}/resumenes/buscar?q=${encodeURIComponent(texto)}`);
        if (res.ok) setOpciones(await res.json());
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [texto, elegido, empresaSlug]);

  // Cierre al clickear fuera (sin librerías: listener global mientras está abierto).
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  return (<>
    <div className="flex-1 relative" ref={raiz}>
      <label className="label">Buscar movimiento manualmente</label>
      <input type="hidden" name="movimientoId" value={elegido?.id ?? ''} />
      {elegido ? (
        <div className="input flex items-center gap-2">
          <span className="flex-1 truncate">{elegido.nombre}</span>
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{elegido.monto}</span>
          <span className="text-xs text-slate-500 whitespace-nowrap">{elegido.fecha}</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600"
            title="Quitar selección"
            onClick={() => { setElegido(null); setTexto(''); }}
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          className="input"
          placeholder="Contraparte, descripción, número o CUIT…"
          autoComplete="off"
        />
      )}
      {abierto && !elegido && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
          {buscando && <p className="px-3 py-2 text-xs text-slate-400">Buscando…</p>}
          {!buscando && opciones.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">Sin resultados conciliables.</p>
          )}
          {opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sky-50"
              onClick={() => { setElegido(o); setAbierto(false); }}
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
    <button className="btn-secondary text-sm" disabled={!elegido}>Conciliar</button>
  </>);
}
