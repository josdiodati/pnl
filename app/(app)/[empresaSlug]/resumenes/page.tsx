import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL } from '@/lib/periodos';
import { formatMoney } from '@/lib/format';
import { ResumenesUpload } from '@/components/resumenes-upload';
import { OkBanner } from '@/components/error-banner';
import { AutoRefresh } from '@/components/auto-refresh';

// Lista de resúmenes de tarjeta/banco: estado de extracción + avance de
// conciliación de sus líneas. El detalle (bandeja de conciliación por línea)
// vive en resumenes/[id] (Task 7).

const TIPO_LABEL: Record<string, string> = { TARJETA: 'Tarjeta', BANCO: 'Banco' };
const TIPO_COLOR: Record<string, string> = {
  TARJETA: 'bg-accent-soft text-accent-strong',
  BANCO: 'bg-line/60 text-ink-mute',
};
// "Resuelta" = ya no espera acción del validador (conciliada, imputada o descartada).
const ESTADOS_RESUELTOS = new Set(['CONCILIADA', 'IMPUTADA', 'IGNORADA']);

export default async function ResumenesPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const base = `/${params.empresaSlug}/resumenes`;

  const [resumenes, jobsFallados, jobsEnCola] = await Promise.all([
    ctx.db.resumen.findMany({
      include: { periodo: true, lineas: { select: { estado: true, monto: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.job.findMany({
      where: { tipo: 'EXTRACCION_RESUMEN', empresaId: ctx.empresa.id, estado: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.job.count({
      where: { tipo: 'EXTRACCION_RESUMEN', empresaId: ctx.empresa.id, estado: { in: ['queued', 'processing'] } },
    }),
  ]);

  const hayProcesando = resumenes.some((r) => r.estado === 'PROCESANDO') || jobsEnCola > 0;

  return (
    <div className="space-y-4">
      <AutoRefresh activo={hayProcesando} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Resúmenes</h1>
          <p className="text-xs text-slate-500">Resúmenes de tarjeta y banco para conciliar contra el libro.</p>
        </div>
        <ResumenesUpload empresaSlug={params.empresaSlug} />
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
      {jobsEnCola > 0 && (
        <p className="text-sm text-amber-600">
          ⏳ {jobsEnCola} resumen{jobsEnCola !== 1 ? 'es' : ''} en procesamiento… (esta página se actualiza sola)
        </p>
      )}
      {jobsFallados.length > 0 && (
        <div className="card p-3 border-red-200">
          <p className="text-sm font-medium text-red-700">Resúmenes con error de procesamiento</p>
          {jobsFallados.map((j) => (
            <p key={j.id} className="text-xs text-red-600">{j.error}</p>
          ))}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Emisor</th>
              <th>Tipo</th>
              <th>Período</th>
              <th className="text-right">Total declarado</th>
              <th>Conciliación</th>
              <th>Extracción</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {resumenes.map((r) => {
              const total = r.lineas.length;
              const resueltas = r.lineas.filter((l) => ESTADOS_RESUELTOS.has(l.estado)).length;
              const pct = total > 0 ? Math.round((resueltas / total) * 100) : 0;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="font-medium">{r.emisor}</td>
                  <td>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TIPO_COLOR[r.tipo]}`}>
                      {TIPO_LABEL[r.tipo]}
                    </span>
                  </td>
                  <td>{MES_LABEL[r.periodo.mes]} {r.periodo.anio}</td>
                  <td className="num">{r.totalDeclarado != null ? formatMoney(Number(r.totalDeclarado)) : '—'}</td>
                  <td>
                    {total > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded bg-slate-200 overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 tabular-nums">{resueltas}/{total}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {r.estado === 'PROCESANDO' && <span className="text-amber-600">⏳ procesando</span>}
                    {r.estado === 'EXTRAIDO' && <span className="text-accent-strong">✔ extraído</span>}
                    {r.estado === 'ERROR_PROCESAMIENTO' && (
                      <span className="text-red-600">✖ error{r.nota ? `: ${r.nota}` : ''}</span>
                    )}
                  </td>
                  <td><Link href={`${base}/${r.id}`} className="btn-secondary text-xs">Abrir</Link></td>
                </tr>
              );
            })}
            {resumenes.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">Sin resúmenes: subí un PDF para empezar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
