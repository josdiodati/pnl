import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { resumirLote, RESULTADO_LABEL } from '@/lib/movimientos/lotes';

const LOTE_RECIENTE_MS = 30 * 60 * 1000;
import { formatFechaHora } from '@/lib/format';
import { UploadZone } from '@/components/upload-zone';
import { PageHeader } from '@/components/page-header';
import { CanalBadge } from '@/components/badges';
import { AutoRefresh } from '@/components/auto-refresh';

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
    { estado: 'DUPLICADO', label: 'Duplicados', acento: 'border-t-slate-400' },
    { estado: 'ERROR_PROCESAMIENTO', label: 'Errores', acento: 'border-t-red-400' },
  ];

  // Historial de lotes: cada drop web / mail / mensaje de Telegram, con su
  // progreso y resultados derivados de los movimientos (nada materializado).
  const lotes = await ctx.db.loteIngesta.findMany({
    where: esValidador ? {} : { creadoPorId: ctx.usuario.id },
    include: {
      creadoPor: { select: { nombre: true } },
      movimientos: { select: { estado: true, flags: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const conResumen = lotes.map((l) => ({ lote: l, resumen: resumirLote(l.movimientos) }));
  // Faltan comprobantes respecto de lo esperado sólo cuenta como "en curso"
  // mientras el lote es reciente: más tarde, lo que falta no va a aparecer
  // (p. ej. duplicados borrados) y la barra quedaría procesando para siempre.
  const loteEnCurso = (lote: { archivos: number; createdAt: Date }, resumen: { total: number; enProceso: number }) =>
    resumen.enProceso > 0 || (resumen.total < lote.archivos && Date.now() - lote.createdAt.getTime() < LOTE_RECIENTE_MS);
  const hayEnCurso = conResumen.some(
    ({ lote, resumen }) => loteEnCurso(lote, resumen),
  );

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
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
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

      <div className="reveal reveal-4 mt-8">
        <AutoRefresh activo={hayEnCurso} />
        <h2 className="label !text-[12px] mb-3">Procesamientos</h2>
        {conResumen.length === 0 ? (
          <p className="text-sm text-ink-mute">Todavía no hay lotes: subí comprobantes y acá vas a ver cómo terminó cada tanda.</p>
        ) : (
          <div className="card divide-y divide-line/60">
            {conResumen.map(({ lote, resumen }) => {
              const enCurso = loteEnCurso(lote, resumen);
              const esperado = Math.max(enCurso ? lote.archivos : resumen.total, resumen.total, 1);
              const completados = resumen.total - resumen.enProceso;
              const pct = Math.round((completados / esperado) * 100);
              return (
                <div key={lote.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="whitespace-nowrap text-ink-mute">{formatFechaHora(lote.createdAt)}</span>
                    <CanalBadge canal={lote.canal} />
                    <span className="text-ink-mute text-xs">
                      {lote.creadoPor?.nombre ?? lote.origenDetalle ?? '—'}
                      {lote.creadoPor && lote.origenDetalle ? ` · ${lote.origenDetalle}` : ''}
                    </span>
                    <span className="font-medium tabular-nums">
                      {esperado} comprobante{esperado !== 1 ? 's' : ''}
                    </span>
                    {enCurso && (
                      <span className="text-xs text-sky-700 tabular-nums">procesando {completados}/{esperado}…</span>
                    )}
                  </div>
                  {enCurso ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                      <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {resumen.resultados.map((r) => (
                        <span
                          key={r.clave}
                          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_CLASES[r.clave] ?? 'bg-line/50 text-ink-mute'}`}
                        >
                          {r.cantidad} {RESULTADO_LABEL[r.clave]}
                        </span>
                      ))}
                      {resumen.total === 0 && <span className="text-xs text-ink-mute">sin comprobantes ingresados</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Colores de los chips de resultado, alineados con los acentos de las tarjetas.
const CHIP_CLASES: Record<string, string> = {
  pendientes: 'bg-amber-100 text-amber-800',
  'auto-validados': 'bg-emerald-100 text-emerald-800',
  'auto-asignados': 'bg-emerald-200 text-emerald-900',
  observados: 'bg-violet-100 text-violet-800',
  retenidos: 'bg-orange-100 text-orange-800',
  'archivo-duplicado': 'bg-slate-200 text-slate-700',
  duplicados: 'bg-slate-100 text-slate-600',
  errores: 'bg-red-100 text-red-800',
  anulados: 'bg-line/50 text-ink-mute',
};
