import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';

// Tab bar removed: the sidebar now links straight to each master. This layout
// just keeps the section gate (VALIDADOR+) and the shared header.
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
      <PageHeader
        titulo="Maestros"
        descripcion="Plan de cuentas de gestión, centros de costo, clientes/proyectos, contrapartes y plantillas. Nada se borra: se desactiva."
      />
      <div className="reveal reveal-2">{children}</div>
    </div>
  );
}
