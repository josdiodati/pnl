'use client';

import { useEffect, useRef } from 'react';

/**
 * Lleva a la vista al elemento que lo contiene apenas se monta. Para el aviso
 * de error: una acción lanzada desde abajo de una tabla larga (el ⚡ de una
 * línea de resumen) vuelve con `?error=` y el banner queda arriba, fuera de
 * pantalla — sin esto parece que el botón "no hizo nada".
 */
export function TraerAVista() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);
  return <span ref={ref} hidden />;
}
