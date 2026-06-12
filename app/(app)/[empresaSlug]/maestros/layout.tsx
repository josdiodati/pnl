import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';

const TABS = [
  { seg: 'categorias', label: 'Categorías' },
  { seg: 'centros-costo', label: 'Centros de costo' },
  { seg: 'clientes-proyectos', label: 'Clientes / Proyectos' },
  { seg: 'contrapartes', label: 'Contrapartes' },
  { seg: 'distribuciones', label: 'Plantillas de distribución' },
];

export default async function MaestrosLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { empresaSlug: string };
}) {
  await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  return (
    <div>
      <h1 className="text-lg font-semibold mb-3">Maestros</h1>
      <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.seg}
            href={`/${params.empresaSlug}/maestros/${t.seg}`}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900 whitespace-nowrap"
          >
            {t.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
