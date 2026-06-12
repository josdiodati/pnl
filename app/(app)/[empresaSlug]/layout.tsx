import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza, ROL_LABEL } from '@/lib/roles';
import { signOut } from '@/lib/auth';
import { EmpresaSwitcher } from '@/components/empresa-switcher';

// Every page under /[empresaSlug] re-validates membership via requireEmpresa
// in its own loader/actions; this layout renders the chrome (nav + switcher).
export default async function EmpresaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { empresaSlug: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug);
  const membresias = await prisma.usuarioEmpresa.findMany({
    where: { usuarioId: ctx.usuario.id },
    include: { empresa: true },
    orderBy: { empresa: { razonSocial: 'asc' } },
  });

  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');
  const esAdmin = rolAlcanza(ctx.rol, 'ADMINISTRADOR');
  const base = `/${ctx.empresa.slug}`;

  const nav: { href: string; label: string }[] = [
    { href: `${base}/carga`, label: 'Carga' },
    ...(esValidador ? [{ href: `${base}/validacion`, label: 'Validación' }] : []),
    { href: `${base}/movimientos`, label: 'Movimientos' },
    { href: `${base}/asientos`, label: 'Asientos' },
    ...(esValidador ? [{ href: `${base}/maestros`, label: 'Maestros' }] : []),
    ...(esValidador ? [{ href: `${base}/periodos`, label: 'Períodos' }] : []),
    ...(esAdmin ? [{ href: `${base}/config`, label: 'Configuración' }] : []),
    ...(esAdmin ? [{ href: `${base}/auditoria`, label: 'Auditoría' }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="flex items-center gap-4 px-4 py-2">
          <span className="font-semibold whitespace-nowrap">P&amp;L Manager</span>
          <EmpresaSwitcher
            actual={ctx.empresa.slug}
            empresas={membresias.map((m) => ({
              slug: m.empresa.slug,
              nombre: m.empresa.razonSocial,
              rol: ROL_LABEL[m.rol],
            }))}
          />
          <span className="text-xs rounded bg-slate-700 px-2 py-0.5">{ROL_LABEL[ctx.rol]}</span>
          <div className="flex-1" />
          <span className="text-sm text-slate-300 hidden sm:block">{ctx.usuario.nombre}</span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button className="text-xs text-slate-300 hover:text-white underline">Salir</button>
          </form>
        </div>
        <nav className="px-4 flex gap-1 overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 text-sm text-slate-300 hover:text-white whitespace-nowrap border-b-2 border-transparent hover:border-slate-400"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 p-4 max-w-screen-2xl w-full mx-auto">{children}</main>
    </div>
  );
}
