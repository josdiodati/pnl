import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUsuario } from '@/lib/empresa/require-empresa';
import { ROL_LABEL } from '@/lib/roles';
import { signOut } from '@/lib/auth';
import { CrearEmpresaForm } from '@/components/crear-empresa-form';

export default async function EmpresasPage() {
  const usuario = await requireUsuario();
  const membresias = await prisma.usuarioEmpresa.findMany({
    where: { usuarioId: usuario.id },
    include: { empresa: true },
    orderBy: { empresa: { razonSocial: 'asc' } },
  });

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold">Tus empresas</h1>
              <p className="text-sm text-slate-500">{usuario.nombre} · {usuario.email}</p>
            </div>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button className="btn-secondary text-xs">Salir</button>
            </form>
          </div>
          {membresias.length === 0 ? (
            <p className="text-sm text-slate-500 mb-2">
              Todavía no pertenecés a ninguna empresa. Creá una nueva o pedí una invitación.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {membresias.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/${m.empresa.slug}/carga`}
                    className="flex items-center justify-between py-3 px-2 -mx-2 rounded hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium">{m.empresa.razonSocial}</p>
                      <p className="text-xs text-slate-500">CUIT {m.empresa.cuit}</p>
                    </div>
                    <span className="text-xs rounded bg-slate-100 px-2 py-1 text-slate-600">{ROL_LABEL[m.rol]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-6">
          <h2 className="font-semibold mb-3">Crear una empresa nueva</h2>
          <CrearEmpresaForm />
        </div>
      </div>
    </main>
  );
}
