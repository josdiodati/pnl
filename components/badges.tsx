import type { EstadoMovimiento } from '@prisma/client';
import { ESTADO_LABEL } from '@/lib/movimientos/estados';

// Color is used ONLY for states (per UX spec): green validated, amber review,
// red alert/voided, neutral not-verified. Everything else stays ink-on-paper.

const ESTADO_COLOR: Record<EstadoMovimiento, string> = {
  INGRESADO: 'bg-line/60 text-ink-mute',
  PROCESANDO: 'bg-sky-100 text-sky-800',
  PENDIENTE_VALIDACION: 'bg-amber-100 text-amber-800',
  RETENIDO: 'bg-orange-100 text-orange-800',
  OBSERVADO: 'bg-violet-100 text-violet-800',
  VALIDADO: 'bg-accent-soft text-accent-strong',
  ANULADO: 'bg-red-100 text-red-700 line-through',
  ERROR_PROCESAMIENTO: 'bg-red-100 text-red-800',
};

export function EstadoBadge({ estado }: { estado: EstadoMovimiento }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${ESTADO_COLOR[estado]}`}>
      {ESTADO_LABEL[estado]}
    </span>
  );
}

export function ArcaBadge({ estado }: { estado: string }) {
  const estilos: Record<string, [string, string]> = {
    VALIDO: ['bg-accent-soft text-accent-strong', 'ARCA válido'],
    INVALIDO: ['bg-red-100 text-red-800', 'ARCA INVÁLIDO'],
    ERROR_CONSULTA: ['bg-line/60 text-ink-mute', 'ARCA: error de consulta'],
    NO_VERIFICADO: ['bg-line/40 text-ink-mute/80', 'ARCA no verificado'],
  };
  const [clase, label] = estilos[estado] ?? estilos.NO_VERIFICADO;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${clase}`}>{label}</span>;
}

export function QrBadge({ estado }: { estado: string | null }) {
  // Verde: tiene QR y se leyó. Amarillo: tiene pero no se pudo usar. Rojo: no tiene.
  const estilos: Record<string, [string, string]> = {
    OK: ['bg-accent-soft text-accent-strong', 'QR ✓'],
    ILEGIBLE: ['bg-amber-100 text-amber-800', 'QR ilegible'],
    SIN_QR: ['bg-red-100 text-red-700', 'sin QR'],
  };
  if (!estado || !estilos[estado]) return null;
  const [clase, label] = estilos[estado];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${clase}`}>{label}</span>;
}

export function CanalBadge({ canal }: { canal: string | null }) {
  if (!canal) return null;
  const labels: Record<string, string> = { WEB: 'Web', FOTO: 'Foto', EMAIL: 'Email', TELEGRAM: 'Telegram', MANUAL: 'Manual' };
  return (
    <span className="inline-block rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-mute whitespace-nowrap">
      {labels[canal] ?? canal}
    </span>
  );
}
