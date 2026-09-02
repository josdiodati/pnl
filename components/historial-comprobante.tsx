import { prisma } from '@/lib/db';
import type { ScopedDb } from '@/lib/empresa/scope';
import { formatFechaHora } from '@/lib/format';
import { formatearHistorial, type EventoCrudo } from '@/lib/historial/formato';

// Historial del comprobante: la MISMA sección en toda vista de detalle
// (Validación, Asignación, panel de Resúmenes). Autocontenido: consulta el
// AuditLog y los maestros para resolver ids a nombres; los maestros de una
// empresa son chicos, no vale la pena deduplicar con las queries de cada página.

export async function HistorialComprobante({
  db,
  empresaId,
  mov,
}: {
  db: ScopedDb;
  empresaId: string;
  mov: { id: string; createdAt: Date; canalIngreso: string | null; creadoPorId: string | null };
}) {
  const [eventos, miembros, contrapartes, categorias, centros, clientes, proyectos] = await Promise.all([
    db.auditLog.findMany({ where: { entidad: 'Movimiento', entidadId: mov.id }, orderBy: { createdAt: 'asc' } }),
    prisma.usuarioEmpresa.findMany({ where: { empresaId }, include: { usuario: true } }),
    db.contraparte.findMany({ select: { id: true, razonSocial: true } }),
    db.categoria.findMany({ select: { id: true, nombre: true } }),
    db.centroCosto.findMany({ select: { id: true, nombre: true } }),
    db.cliente.findMany({ select: { id: true, nombre: true } }),
    db.proyecto.findMany({ select: { id: true, nombre: true } }),
  ]);

  const usuarios = new Map(miembros.map((m) => [m.usuarioId, m.usuario.nombre]));
  const items = formatearHistorial(eventos as EventoCrudo[], {
    usuarios,
    contrapartes: new Map(contrapartes.map((c) => [c.id, c.razonSocial])),
    categorias: new Map(categorias.map((c) => [c.id, c.nombre])),
    centros: new Map(centros.map((c) => [c.id, c.nombre])),
    clientes: new Map(clientes.map((c) => [c.id, c.nombre])),
    proyectos: new Map(proyectos.map((p) => [p.id, p.nombre])),
  });

  // Ítem sintético de carga solo si no hay evento CREAR (movimientos anteriores
  // al registro de auditoría, o creados por caminos que no lo escribían).
  const hayCrear = eventos.some((e) => e.accion === 'CREAR' || e.accion === 'CREAR_Y_VALIDAR');

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-slate-600 mb-2">Historial</h2>
      <ol className="space-y-2 text-sm">
        {!hayCrear && (
          <li className="text-slate-700">
            <span className="text-slate-400 tabular-nums">{formatFechaHora(mov.createdAt)}</span>
            {' — '}
            <span className="font-medium">{mov.creadoPorId ? (usuarios.get(mov.creadoPorId) ?? 'Usuario') : 'Sistema'}</span>
            {' · '}Cargado vía {mov.canalIngreso ?? '—'}
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
