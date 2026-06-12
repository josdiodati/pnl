import type { EstadoMovimiento } from '@prisma/client';
import { ESTADO_LABEL } from '@/lib/movimientos/estados';

// Color is used ONLY for states (per UX spec): green validated, yellow review,
// red alert/voided, gray not verified.

const ESTADO_COLOR: Record<EstadoMovimiento, string> = {
  INGRESADO: 'bg-slate-100 text-slate-700',
  PROCESANDO: 'bg-blue-50 text-blue-700',
  PENDIENTE_VALIDACION: 'bg-amber-100 text-amber-800',
  RETENIDO: 'bg-orange-100 text-orange-800',
  OBSERVADO: 'bg-purple-100 text-purple-800',
  VALIDADO: 'bg-emerald-100 text-emerald-800',
  ANULADO: 'bg-red-100 text-red-700 line-through',
  ERROR_PROCESAMIENTO: 'bg-red-100 text-red-800',
};

export function EstadoBadge({ estado }: { estado: EstadoMovimiento }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${ESTADO_COLOR[estado]}`}>
      {ESTADO_LABEL[estado]}
    </span>
  );
}

export function ArcaBadge({ estado }: { estado: string }) {
  const estilos: Record<string, [string, string]> = {
    VALIDO: ['bg-emerald-100 text-emerald-800', 'ARCA válido'],
    INVALIDO: ['bg-red-100 text-red-800', 'ARCA INVÁLIDO'],
    ERROR_CONSULTA: ['bg-slate-200 text-slate-600', 'ARCA: error de consulta'],
    NO_VERIFICADO: ['bg-slate-100 text-slate-500', 'ARCA no verificado'],
  };
  const [clase, label] = estilos[estado] ?? estilos.NO_VERIFICADO;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${clase}`}>{label}</span>;
}

export function CanalBadge({ canal }: { canal: string | null }) {
  if (!canal) return null;
  const labels: Record<string, string> = { WEB: 'Web', FOTO: 'Foto', EMAIL: 'Email', TELEGRAM: 'Telegram', MANUAL: 'Manual' };
  return (
    <span className="inline-block rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 whitespace-nowrap">
      {labels[canal] ?? canal}
    </span>
  );
}
