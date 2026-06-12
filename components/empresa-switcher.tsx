'use client';

import { usePathname, useRouter } from 'next/navigation';

// Always-visible company switcher (topbar). Changing it swaps the slug in the
// URL, keeping the current section when possible.
export function EmpresaSwitcher({
  actual,
  empresas,
}: {
  actual: string;
  empresas: { slug: string; nombre: string; rol: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  function cambiar(slug: string) {
    if (slug === actual) return;
    const resto = pathname.split('/').slice(2).join('/') || 'carga';
    // Sections that may not exist under the new role land on the 403 redirect
    router.push(`/${slug}/${resto.split('/')[0]}`);
  }

  return (
    <select
      value={actual}
      onChange={(e) => cambiar(e.target.value)}
      className="rounded border border-line bg-surface px-2 py-1.5 text-sm font-medium text-tinta max-w-[230px] focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      aria-label="Empresa activa"
    >
      {empresas.map((e) => (
        <option key={e.slug} value={e.slug}>
          {e.nombre} ({e.rol})
        </option>
      ))}
    </select>
  );
}
