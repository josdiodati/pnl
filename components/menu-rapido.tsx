'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// El ⚡ de acciones rápidas de la bandeja de resúmenes. Es un <details> nativo
// (lo de adentro sigue siendo un <form> con server action, sin estado de
// cliente), pero <details> no se cierra al clickear afuera: eso lo agrega este
// wrapper, junto con Escape. Los listeners se enganchan sólo mientras está
// abierto — una bandeja tiene un menú por línea.
export function MenuRapido({
  etiqueta,
  titulo,
  children,
}: {
  etiqueta: ReactNode;
  titulo?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const cerrarSiEsAfuera = (e: MouseEvent) => {
      const det = ref.current;
      if (det && e.target instanceof Node && !det.contains(e.target)) setAbierto(false);
    };
    const cerrarConEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', cerrarSiEsAfuera);
    document.addEventListener('keydown', cerrarConEscape);
    return () => {
      document.removeEventListener('mousedown', cerrarSiEsAfuera);
      document.removeEventListener('keydown', cerrarConEscape);
    };
  }, [abierto]);

  return (
    <details
      ref={ref}
      open={abierto}
      onToggle={(e) => setAbierto(e.currentTarget.open)}
      className="relative inline-block ml-1 align-middle"
    >
      <summary
        className="list-none cursor-pointer rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-amber-50 hover:border-amber-300 select-none"
        title={titulo}
      >
        {etiqueta}
      </summary>
      {children}
    </details>
  );
}
