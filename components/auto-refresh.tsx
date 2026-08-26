'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresca la página cada `intervaloMs` mientras `activo` sea true — para
 * pantallas con trabajo en curso (lotes procesándose). Cuando no hay nada en
 * curso no hace ningún request.
 */
export function AutoRefresh({ activo, intervaloMs = 4000 }: { activo: boolean; intervaloMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!activo) return;
    const timer = setInterval(() => router.refresh(), intervaloMs);
    return () => clearInterval(timer);
  }, [activo, intervaloMs, router]);
  return null;
}
