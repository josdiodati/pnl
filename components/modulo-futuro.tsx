import Link from 'next/link';
import { Icono } from './iconos';

// Placeholder screen for next-stage modules: states clearly that the module
// is out of MVP scope, what it will do, and that the data model is ready.
export function ModuloFuturo({
  empresaSlug,
  icono,
  titulo,
  resumen,
  incluira,
  modeloListo,
}: {
  empresaSlug: string;
  icono: string;
  titulo: string;
  resumen: string;
  incluira: string[];
  modeloListo: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="reveal reveal-1 flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-strong">
          Próxima etapa · backlog
        </span>
      </div>

      <div className="reveal reveal-2">
        <div className="flex items-start gap-4">
          <span className="mt-1 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-ink text-paper">
            <Icono nombre={icono} className="w-6 h-6" />
          </span>
          <div>
            <h1 className="titulo-pagina">{titulo}</h1>
            <span className="rule-doble" />
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-tinta/90">{resumen}</p>
      </div>

      <div className="reveal reveal-3 card mt-6 border-dashed p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-mute mb-3">Qué va a incluir</h2>
        <ul className="space-y-2">
          {incluira.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm text-tinta/85">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="reveal reveal-4 mt-5 rounded-lg bg-accent-soft/60 border border-accent/15 px-4 py-3">
        <p className="text-[13px] text-accent-strong">
          <strong className="font-semibold">El modelo de datos ya lo contempla:</strong> {modeloListo}
        </p>
      </div>

      <div className="reveal reveal-4 mt-6">
        <Link href={`/${empresaSlug}/carga`} className="btn-secondary">
          ← Volver a la operación
        </Link>
      </div>
    </div>
  );
}
