import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { reportesVisibles } from '@/lib/reportes-personalizados/acceso';
import { PageHeader } from '@/components/page-header';

// Índice de reportes personalizados: sólo los que este usuario tiene
// habilitados en esta empresa (se habilitan en Configuración).

export default async function ReportesPersonalizadosPage({ params }: { params: { empresaSlug: string } }) {
  const ctx = await requireEmpresaPage(params.empresaSlug);
  const reportes = await reportesVisibles(ctx);
  return (
    <div>
      <PageHeader
        titulo="Reportes personalizados"
        descripcion="Reportes armados a pedido, con la mirada que le sirve a cada uno. Ves los que tenés habilitados en esta empresa."
      />
      {reportes.length === 0 ? (
        <p className="card p-4 text-sm text-ink-mute">
          No tenés reportes personalizados habilitados. Pedíselos a un administrador de la empresa.
        </p>
      ) : (
        <div className="reveal reveal-2 grid gap-3 sm:grid-cols-2">
          {reportes.map((r) => (
            <Link
              key={r.id}
              href={`/${params.empresaSlug}/reportes-personalizados/${r.id}`}
              className="card p-4 transition-colors hover:border-ink-mute"
            >
              <p className="font-display text-lg">{r.titulo}</p>
              <p className="mt-1 text-sm text-ink-mute">{r.descripcion}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
