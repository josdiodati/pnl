import Link from 'next/link';
import { MES_LABEL } from '@/lib/periodos';

// Selector ← Ejercicio 2026/2027 (Julio 2026 – Junio 2027) → de las vistas
// organizadas por ejercicio contable. `href` arma el link de otro ejercicio.
export function SelectorEjercicio({
  ejercicio,
  inicio,
  href,
}: {
  ejercicio: number;
  inicio: number;
  href: (ejercicio: number) => string;
}) {
  const finAnio = inicio === 1 ? ejercicio : ejercicio + 1;
  return (
    <div className="flex items-center gap-2">
      <Link href={href(ejercicio - 1)} className="btn-secondary text-xs">←</Link>
      <span className="text-sm font-medium">
        Ejercicio {inicio === 1 ? ejercicio : `${ejercicio}/${ejercicio + 1}`} ({MES_LABEL[inicio]} {ejercicio} – {MES_LABEL[inicio === 1 ? 12 : inicio - 1]} {finAnio})
      </span>
      <Link href={href(ejercicio + 1)} className="btn-secondary text-xs">→</Link>
    </div>
  );
}
