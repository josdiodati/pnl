import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { UploadZone } from '@/components/upload-zone';
import { PageHeader } from '@/components/page-header';

// Home: upload + pipeline status cards, always visible (UX spec: the user
// must always know how many vouchers are waiting on them).
export default async function CargaPage({ params }: { params: { empresaSlug: string } }) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  // Loaders only see their own uploads (permission table, doc 08)
  const filtroPropio = esValidador ? {} : { creadoPorId: ctx.usuario.id };
  const grupos = await ctx.db.movimiento.groupBy({
    by: ['estado'],
    where: filtroPropio,
    _count: { _all: true },
  });
  const conteo = Object.fromEntries(grupos.map((g) => [g.estado, g._count._all]));

  const tarjetas = [
    { estado: 'INGRESADO', label: 'Ingresados', acento: 'border-t-ink-mute/40' },
    { estado: 'PROCESANDO', label: 'Procesando', acento: 'border-t-sky-400' },
    { estado: 'PENDIENTE_VALIDACION', label: 'Pendientes de validación', acento: 'border-t-amber-400' },
    { estado: 'RETENIDO', label: 'Retenidos (mes cerrado)', acento: 'border-t-orange-400' },
    { estado: 'OBSERVADO', label: 'Observados', acento: 'border-t-violet-400' },
    { estado: 'ERROR_PROCESAMIENTO', label: 'Errores', acento: 'border-t-red-400' },
  ];

  const destino = (estado: string) =>
    esValidador && !['INGRESADO', 'PROCESANDO'].includes(estado)
      ? `/${params.empresaSlug}/validacion?estado=${estado}`
      : `/${params.empresaSlug}/comprobantes?estado=${estado}`;

  return (
    <div>
      <PageHeader
        titulo="Carga de comprobantes"
        descripcion="Arrastrá facturas en PDF o foto y el pipeline hace el resto: OCR, checks, ARCA y cola de validación."
      />

      <div className="reveal reveal-2">
        <UploadZone empresaSlug={params.empresaSlug} />
      </div>

      <div className="reveal reveal-3 mt-8">
        <h2 className="label !text-[12px] mb-3">Estado del pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {tarjetas.map((t) => (
            <Link
              key={t.estado}
              href={destino(t.estado)}
              className={`card border-t-[3px] ${t.acento} p-4 transition-all hover:shadow-lift hover:-translate-y-0.5`}
            >
              <p className="font-mono text-[26px] font-semibold leading-none tabular-nums">{conteo[t.estado] ?? 0}</p>
              <p className="mt-2 text-[11.5px] text-ink-mute leading-tight">{t.label}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-mute/80">
          Los comprobantes también entran por <strong>email</strong> y <strong>Telegram</strong> (Configuración →
          canales). El worker (<code className="rounded bg-line/50 px-1 font-mono text-[11px]">npm run worker</code>)
          tiene que estar corriendo para procesarlos.
        </p>
      </div>
    </div>
  );
}
