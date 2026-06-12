'use client';

import { usePathname, useRouter } from 'next/navigation';

// Always-visible company switcher (header). Changing it swaps the slug in the
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
    // Sections that may not exist under the new role land on /carga via 403→redirect
    router.push(`/${slug}/${resto.split('/')[0]}`);
  }

  return (
    <select
      value={actual}
      onChange={(e) => cambiar(e.target.value)}
      className="bg-slate-800 text-white text-sm rounded border border-slate-600 px-2 py-1 max-w-[220px]"
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
