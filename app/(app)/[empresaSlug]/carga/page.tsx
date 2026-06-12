import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { UploadZone } from '@/components/upload-zone';

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
    { estado: 'INGRESADO', label: 'Ingresados', color: 'border-slate-300' },
    { estado: 'PROCESANDO', label: 'Procesando', color: 'border-blue-300' },
    { estado: 'PENDIENTE_VALIDACION', label: 'Pendientes de validación', color: 'border-amber-400' },
    { estado: 'RETENIDO', label: 'Retenidos (mes cerrado)', color: 'border-orange-400' },
    { estado: 'OBSERVADO', label: 'Observados', color: 'border-purple-400' },
    { estado: 'ERROR_PROCESAMIENTO', label: 'Errores', color: 'border-red-400' },
  ];

  const destino = (estado: string) =>
    esValidador && estado !== 'INGRESADO' && estado !== 'PROCESANDO'
      ? `/${params.empresaSlug}/validacion?estado=${estado}`
      : `/${params.empresaSlug}/movimientos?estado=${estado}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold mb-3">Carga de comprobantes</h1>
        <UploadZone empresaSlug={params.empresaSlug} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-2">Estado del pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {tarjetas.map((t) => (
            <Link key={t.estado} href={destino(t.estado)} className={`card border-t-4 ${t.color} p-4 hover:shadow`}>
              <p className="text-2xl font-semibold tabular-nums">{conteo[t.estado] ?? 0}</p>
              <p className="text-xs text-slate-500 mt-1">{t.label}</p>
            </Link>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Los comprobantes también pueden entrar por email y Telegram (configuración → canales). Recordá tener el
          worker corriendo (<code className="bg-slate-100 px-1 rounded">npm run worker</code>) para que se procesen.
        </p>
      </div>
    </div>
  );
}
