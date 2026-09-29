import type { AlertaActiva } from '@/lib/ia/alertas';
import { DESCRIPCION_ERROR_IA, type CodigoErrorIa } from '@/lib/ia/errores';
import { formatFechaHora } from '@/lib/format';

// Alertas abiertas de la extracción con IA (sin crédito, clave revocada…),
// arriba de toda página. Rojo si la extracción está detenida; ámbar si es un
// problema transitorio que agotó los reintentos.

export function AlertasIaBanner({ alertas }: { alertas: AlertaActiva[] }) {
  if (!alertas.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {alertas.map((a) => {
        const detenida = DESCRIPCION_ERROR_IA[a.codigo as CodigoErrorIa]?.alcance === 'GLOBAL';
        return (
          <div
            key={a.id}
            role="alert"
            className={
              detenida
                ? 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800'
                : 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
            }
          >
            <p className="font-semibold">
              {detenida ? 'Extracción con IA detenida' : 'Problemas con la extracción con IA'}: {a.titulo}{' '}
              <code className="rounded bg-white/60 px-1 text-xs font-normal">{a.codigo}</code>
            </p>
            <p className="mt-0.5">Qué hacer: {a.accion}</p>
            <p className="mt-0.5 text-xs opacity-80">
              {detenida
                ? `${a.enEspera === 1 ? '1 documento en espera' : `${a.enEspera} documentos en espera`}: se procesan solos cuando se resuelva. `
                : ''}
              Desde {formatFechaHora(a.primeraVez)} · último {formatFechaHora(a.ultimaVez)} ·{' '}
              {a.ocurrencias === 1 ? '1 vez' : `${a.ocurrencias} veces`}
            </p>
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer opacity-80">Respuesta de la API</summary>
              <p className="mt-1 break-all font-mono">{a.mensaje}</p>
            </details>
          </div>
        );
      })}
    </div>
  );
}
