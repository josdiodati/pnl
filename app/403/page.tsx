import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <p className="text-5xl font-bold text-slate-300 mb-3">403</p>
        <h1 className="text-lg font-semibold mb-2">Acceso denegado</h1>
        <p className="text-sm text-slate-500 mb-6">
          No pertenecés a esta empresa o tu rol no alcanza para ver esta sección.
        </p>
        <Link href="/empresas" className="btn-primary">Ir a mis empresas</Link>
      </div>
    </main>
  );
}
