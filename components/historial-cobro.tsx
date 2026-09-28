import { prisma } from '@/lib/db';
import type { ScopedDb } from '@/lib/empresa/scope';
import { formatFechaHora } from '@/lib/format';
import type { EventoCrudo } from '@/lib/historial/formato';
import { formatearHistorialCobro } from '@/lib/historial/cobro';

// Historial de un cobro: mismo formato que el de los comprobantes (quién lo
// cargó, quién lo editó y qué cambió, cheques, confirmación del resumen).

export async function HistorialCobro({
  db,
  empresaId,
  grupo,
  alta,
  ventas,
}: {
  db: ScopedDb;
  empresaId: string;
  grupo: string;
  /** Alta del cobro, para el ítem sintético si no hay evento de carga. */
  alta: { createdAt: Date; creadoPorId: string | null };
  ventas: Map<string, string>;
}) {
  const [eventos, miembros] = await Promise.all([
    db.auditLog.findMany({ where: { entidad: 'Cobro', entidadId: grupo }, orderBy: { createdAt: 'asc' } }),
    prisma.usuarioEmpresa.findMany({ where: { empresaId }, include: { usuario: true } }),
  ]);
  const usuarios = new Map(miembros.map((m) => [m.usuarioId, m.usuario.nombre]));
  const items = formatearHistorialCobro(eventos as EventoCrudo[], { usuarios, ventas });
  const hayAlta = eventos.some((e) => e.accion === 'COBRO_REGISTRAR');

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-slate-600 mb-2">Historial</h2>
      <ol className="space-y-2 text-sm">
        {!hayAlta && (
          <li className="text-slate-700">
            <span className="text-slate-400 tabular-nums">{formatFechaHora(alta.createdAt)}</span>
            {' — '}
            <span className="font-medium">{alta.creadoPorId ? (usuarios.get(alta.creadoPorId) ?? 'Usuario') : 'Sistema'}</span>
            {' · '}Cobro cargado
          </li>
        )}
        {items.map((item) => (
          <li key={item.id} className="text-slate-700">
            <span className="text-slate-400 tabular-nums">{formatFechaHora(item.fecha)}</span>
            {' — '}
            <span className={item.actor === 'Sistema' ? 'font-medium text-slate-500' : 'font-medium'}>{item.actor}</span>
            {' · '}
            {item.titulo}
            {item.detalles.length > 0 && (
              <ul className="mt-0.5 ml-5 list-disc space-y-0.5 text-xs text-slate-500">
                {item.detalles.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {item.tecnico != null && (
              <details className="ml-5 mt-0.5">
                <summary className="cursor-pointer text-[10px] text-slate-400 select-none">detalle técnico</summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-500 whitespace-pre-wrap break-all">
                  {JSON.stringify(item.tecnico, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
