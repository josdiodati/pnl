import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="reveal reveal-1 card w-full max-w-md p-10 text-center">
        <p className="font-display text-7xl font-semibold text-line">403</p>
        <span className="rule-doble !mx-auto !w-16" />
        <h1 className="mt-4 font-display text-xl font-semibold text-ink">Acceso denegado</h1>
        <p className="mt-2 text-sm text-ink-mute">
          No pertenecés a esta empresa o tu rol no alcanza para ver esta sección.
        </p>
        <Link href="/empresas" className="btn-primary mt-6">Ir a mis empresas</Link>
      </div>
    </main>
  );
}
