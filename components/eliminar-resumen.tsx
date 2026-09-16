'use client';

import { useState } from 'react';
import { eliminarResumenAction } from '@/app/(app)/[empresaSlug]/resumenes/actions';

export const PALABRA_CONFIRMACION = 'ELIMINAR';

// Borrado de un resumen (subido a la empresa equivocada, PDF erróneo) con
// doble validación: un primer click abre el panel, y para habilitar el botón
// definitivo hay que escribir la palabra de confirmación (el servidor la
// revalida). Si hay líneas con comprobantes vinculados, no se puede: se avisa
// qué deshacer primero.
export function EliminarResumen({
  empresaSlug,
  resumenId,
  emisor,
  lineas,
  lineasConComprobantes,
}: {
  empresaSlug: string;
  resumenId: string;
  emisor: string;
  lineas: number;
  lineasConComprobantes: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const bloqueado = lineasConComprobantes > 0;
  const confirmado = texto.trim() === PALABRA_CONFIRMACION;

  if (!abierto) {
    return (
      <button type="button" className="btn-danger text-xs" onClick={() => setAbierto(true)} title="Borra el resumen y sus líneas">
        Eliminar resumen…
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 space-y-2 w-full">
      <p className="font-semibold">¿Eliminar el resumen «{emisor}»?</p>
      {bloqueado ? (
        <p>
          No se puede: {lineasConComprobantes} línea{lineasConComprobantes !== 1 ? 's tienen' : ' tiene'} comprobantes
          vinculados. Primero deshacé esas líneas (una imputación deshecha anula el comprobante que se creó desde ella)
          y después volvé a intentar.
        </p>
      ) : (
        <p>
          Se borran el resumen y sus {lineas} línea{lineas !== 1 ? 's' : ''} (pendientes e ignoradas). El PDF queda en el
          almacén. Esta acción no se puede deshacer: para volver a tenerlo habrá que subirlo de nuevo.
        </p>
      )}
      <form action={eliminarResumenAction} className="flex items-end gap-2 flex-wrap">
        <input type="hidden" name="empresaSlug" value={empresaSlug} />
        <input type="hidden" name="resumenId" value={resumenId} />
        {!bloqueado && (
          <div>
            <label className="label">Escribí {PALABRA_CONFIRMACION} para confirmar</label>
            <input
              name="confirmacion"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="input text-sm w-44"
              autoComplete="off"
              placeholder={PALABRA_CONFIRMACION}
            />
          </div>
        )}
        {!bloqueado && (
          <button className="btn-danger text-sm" disabled={!confirmado}>
            Eliminar definitivamente
          </button>
        )}
        <button type="button" className="btn-secondary text-sm" onClick={() => { setAbierto(false); setTexto(''); }}>
          Cancelar
        </button>
      </form>
    </div>
  );
}
