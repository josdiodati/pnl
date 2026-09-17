import { LimpiarParametrosUrl } from './limpiar-parametros-url';

// Avisos de resultado de una acción (vienen por `?error=` / `?ok=` en la URL).
// Son de una sola vez: el parámetro se limpia de la URL al mostrarse.

export function ErrorBanner({ mensaje }: { mensaje?: string | string[] }) {
  if (!mensaje) return null;
  const texto = Array.isArray(mensaje) ? mensaje[0] : mensaje;
  return (
    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {texto}
      <LimpiarParametrosUrl claves={['error']} />
    </div>
  );
}

export function OkBanner({ mensaje }: { mensaje?: string | string[] }) {
  if (!mensaje) return null;
  const texto = Array.isArray(mensaje) ? mensaje[0] : mensaje;
  return (
    <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
      {texto}
      <LimpiarParametrosUrl claves={['ok']} />
    </div>
  );
}
