import Link from 'next/link';
import { MES_LABEL } from '@/lib/periodos';
import { formatFechaHora } from '@/lib/format';
import { getFileStorage } from '@/lib/storage';
import { listarArchivosRecibos, type ArchivoRecibos, type EstadoPagina } from '@/lib/empleados/archivos';

// Vista "Archivos" de Empleados: log de los PDF de recibos subidos (quién,
// cuándo, qué salió de cada página). Sirve para saber qué se cargó y qué no.

const ETIQUETA: Record<EstadoPagina, string> = {
  CONFIRMADO: 'confirmado',
  PENDIENTE_REVISION: 'pendiente',
  ANULADO: 'anulado',
  FALLIDA: 'con error',
  EN_COLA: 'en proceso',
  SIN_RECIBO: 'sin recibo',
  SIN_PROCESAR: 'sin procesar',
};

const COLOR: Record<EstadoPagina, string> = {
  CONFIRMADO: 'text-emerald-700',
  PENDIENTE_REVISION: 'text-amber-700',
  ANULADO: 'text-slate-500',
  FALLIDA: 'text-red-600',
  EN_COLA: 'text-sky-700',
  SIN_RECIBO: 'text-red-600',
  SIN_PROCESAR: 'text-red-600',
};

const ORDEN: EstadoPagina[] = ['CONFIRMADO', 'PENDIENTE_REVISION', 'ANULADO', 'FALLIDA', 'EN_COLA', 'SIN_RECIBO', 'SIN_PROCESAR'];

export async function ArchivosRecibosVista({ empresaId, base }: { empresaId: string; base: string }) {
  const archivos = await listarArchivosRecibos(empresaId);
  const storage = getFileStorage();
  const urls = await Promise.all(archivos.map((a) => storage.getSignedUrl(a.archivoKey)));

  if (archivos.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-400">Todavía no se subió ningún archivo de recibos.</div>;
  }

  return (
    <div className="card divide-y">
      {archivos.map((a, i) => (
        <details key={a.archivoKey} className="group">
          <summary className="cursor-pointer list-none p-3 hover:bg-slate-50 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-xs text-slate-500 tabular-nums w-32">{formatFechaHora(a.subidoAt)}</span>
            <span className="font-medium text-sm break-all flex-1 min-w-[12rem]">
              <span className="text-slate-400 group-open:rotate-90 inline-block mr-1">›</span>
              {a.archivoNombre}
            </span>
            <span className="text-xs text-slate-600">{a.subidoPor ?? 'desconocido'}</span>
            <Control a={a} />
            <span className="text-xs w-full sm:w-auto">
              {ORDEN.filter((e) => a.conteo[e] > 0).map((e, k) => (
                <span key={e} className={COLOR[e]}>
                  {k > 0 && ' · '}
                  {a.conteo[e]} {ETIQUETA[e]}
                </span>
              ))}
            </span>
            <a href={`${urls[i]}?descargar=1`} download={a.archivoNombre} className="btn-secondary text-xs">
              Bajar original
            </a>
          </summary>
          <div className="px-3 pb-3 space-y-2">
            <p className="text-xs text-slate-500">
              {a.periodos.length > 0 && (
                <>Períodos: {a.periodos.map((p) => `${MES_LABEL[p.mes]} ${p.anio} (${p.cantidad})`).join(', ')} · </>
              )}
              <a href={urls[i]} target="_blank" rel="noreferrer" className="underline">Ver PDF</a>
              {' · '}
              <a href={`${urls[i]}?descargar=1`} download={a.archivoNombre} className="underline">Bajar original</a>
            </p>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Pág.</th><th>Empleado</th><th>Período</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {a.paginas.map((p) => (
                    <tr key={p.pagina}>
                      <td className="tabular-nums">{p.pagina}</td>
                      <td>{p.recibo?.empleadoNombre ?? '—'}</td>
                      <td>{p.recibo ? `${MES_LABEL[p.recibo.mes]} ${p.recibo.anio}` : '—'}</td>
                      <td className={`text-xs ${COLOR[p.estado]}`}>
                        {ETIQUETA[p.estado]}
                        {p.error && <span className="block text-red-600">{p.error}</span>}
                      </td>
                      <td>
                        {p.recibo && (
                          <Link href={`${base}/recibos/${p.recibo.id}`} className="text-xs underline">Ver recibo</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

// Control de integridad: cada página del PDF (recontada del archivo guardado)
// tiene su recibo. Si no, se listan las páginas que faltan.
function Control({ a }: { a: ArchivoRecibos }) {
  if (a.verificacion.ok) {
    return (
      <span className="text-xs text-emerald-700" title="Cada página del PDF tiene su recibo">
        ✓ {a.verificacion.conRecibo}/{a.paginasPdf} pág. con recibo
      </span>
    );
  }
  const total = a.paginasPdf ?? a.paginas.length;
  const enCurso = a.paginas.some((p) => p.estado === 'EN_COLA');
  return (
    <span className={`text-xs ${enCurso ? 'text-sky-700' : 'text-red-600 font-medium'}`}>
      {enCurso ? '⏳' : '⚠'} {a.verificacion.conRecibo}/{total} pág. con recibo
      {a.paginasPdf == null && ' (no se pudo leer el PDF)'}
      {!enCurso && a.verificacion.faltantes.length > 0 && ` — faltan: ${a.verificacion.faltantes.join(', ')}`}
    </span>
  );
}
