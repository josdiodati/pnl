'use client';

import { useEffect, useRef, useState } from 'react';

type Opcion = { id: string; nombre: string; descripcion: string; fecha: string; monto: string; vinculadoA: string | null };

// Buscador con autocompletado para el panel de conciliación: se escribe texto
// (contraparte, descripción, número, CUIT) y se elige un movimiento de los
// resultados. El elegido queda en un hidden `movimientoId` dentro del form del
// server action; hasta que no hay elección, el botón va deshabilitado.
// Un comprobante que ya está vinculado a otra línea (se pagó en más de un
// movimiento) se marca y exige tildar la confirmación antes de conciliar.
export function BuscadorMovimiento({
  empresaSlug,
  lineaId,
  etiqueta = 'Conciliar',
  titulo = 'Buscar movimiento manualmente',
}: {
  empresaSlug: string;
  lineaId?: string;
  etiqueta?: string;
  titulo?: string;
}) {
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Opcion | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (elegido) return;
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const params = new URLSearchParams({ q: texto });
        if (lineaId) params.set('linea', lineaId);
        const res = await fetch(`/${empresaSlug}/resumenes/buscar?${params.toString()}`);
        if (res.ok) setOpciones(await res.json());
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [texto, elegido, empresaSlug, lineaId]);

  // Cierre al clickear fuera (sin librerías: listener global mientras está abierto).
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  const requiereConfirmacion = Boolean(elegido?.vinculadoA);
  const listo = Boolean(elegido) && (!requiereConfirmacion || confirmado);

  return (<>
    <div className="flex-1 relative" ref={raiz}>
      <label className="label">{titulo}</label>
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
            onClick={() => { setElegido(null); setTexto(''); setConfirmado(false); }}
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
              onClick={() => { setElegido(o); setAbierto(false); setConfirmado(false); }}
              title={o.vinculadoA ? `Ya vinculado a la ${o.vinculadoA}` : undefined}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate">
                  {o.nombre}
                  {o.vinculadoA && (
                    <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 align-middle">ya vinculado</span>
                  )}
                </span>
                {o.descripcion && <span className="block truncate text-xs text-slate-400">{o.descripcion}</span>}
              </span>
              <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{o.monto}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">{o.fecha}</span>
            </button>
          ))}
        </div>
      )}
      {requiereConfirmacion && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
          <p>
            <strong>Ojo:</strong> este comprobante ya está vinculado a la {elegido!.vinculadoA}. Sólo corresponde
            vincularlo también acá si el comprobante se pagó en más de un movimiento (pago parcial o en cuotas).
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="confirmarCompartido"
              value="1"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Estoy seguro: este comprobante se pagó en más de un movimiento y esta línea es uno de ellos.
          </label>
        </div>
      )}
    </div>
    <button className="btn-secondary text-sm" disabled={!listo}>{etiqueta}</button>
  </>);
}
