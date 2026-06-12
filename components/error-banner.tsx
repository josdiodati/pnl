export function ErrorBanner({ mensaje }: { mensaje?: string | string[] }) {
  if (!mensaje) return null;
  const texto = Array.isArray(mensaje) ? mensaje[0] : mensaje;
  return (
    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {texto}
    </div>
  );
}

export function OkBanner({ mensaje }: { mensaje?: string | string[] }) {
  if (!mensaje) return null;
  const texto = Array.isArray(mensaje) ? mensaje[0] : mensaje;
  return (
    <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
      {texto}
    </div>
  );
}
