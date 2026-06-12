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
        <div className="reveal reveal-1 card p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Tus empresas</h1>
              <span className="rule-doble" />
              <p className="mt-2 text-sm text-ink-mute">{usuario.nombre} · {usuario.email}</p>
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
            <p className="text-sm text-ink-mute mb-2">
              Todavía no pertenecés a ninguna empresa. Creá una nueva o pedí una invitación.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {membresias.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/${m.empresa.slug}/carga`}
                    className="flex items-center justify-between py-3 px-2 -mx-2 rounded transition-colors hover:bg-accent-soft/40"
                  >
                    <div>
                      <p className="font-medium text-tinta">{m.empresa.razonSocial}</p>
                      <p className="text-xs text-ink-mute font-mono">CUIT {m.empresa.cuit}</p>
                    </div>
                    <span className="rounded border border-line bg-surface px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-ink-mute">
                      {ROL_LABEL[m.rol]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="reveal reveal-2 card p-6">
          <h2 className="font-display text-lg font-semibold text-ink mb-3">Crear una empresa nueva</h2>
          <CrearEmpresaForm />
        </div>
      </div>
    </main>
  );
}
