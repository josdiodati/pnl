'use client';

import { useEffect } from 'react';

/**
 * Saca de la URL los parámetros de aviso (`ok`, `error`) apenas se muestran,
 * así el mensaje es de una sola vez: al recargar o volver a la página no
 * reaparece. Los estados que sí deben persistir (una credencial bloqueada,
 * un resumen de otra empresa) se muestran desde la base, no desde la URL.
 */
export function LimpiarParametrosUrl({ claves }: { claves: string[] }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    let cambio = false;
    for (const k of claves) if (url.searchParams.has(k)) { url.searchParams.delete(k); cambio = true; }
    if (cambio) window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
  }, [claves]);
  return null;
}
