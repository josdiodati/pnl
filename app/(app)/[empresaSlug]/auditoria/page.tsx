import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { formatFechaHora } from '@/lib/format';

// Audit trail browser, ADMIN only: filterable by entity, user, action, date.
export default async function AuditoriaPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { entidad?: string; accion?: string; usuarioId?: string; desde?: string; hasta?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');

  const where: Prisma.AuditLogWhereInput = {
    ...(searchParams.entidad ? { entidad: searchParams.entidad } : {}),
    ...(searchParams.accion ? { accion: { contains: searchParams.accion, mode: 'insensitive' } } : {}),
    ...(searchParams.usuarioId ? { usuarioId: searchParams.usuarioId } : {}),
    ...(searchParams.desde || searchParams.hasta
      ? {
          createdAt: {
            ...(searchParams.desde ? { gte: new Date(`${searchParams.desde}T00:00:00`) } : {}),
            ...(searchParams.hasta ? { lte: new Date(`${searchParams.hasta}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [logs, entidades, miembros] = await Promise.all([
    ctx.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    ctx.db.auditLog.groupBy({ by: ['entidad'] }),
    prisma.usuarioEmpresa.findMany({ where: { empresaId: ctx.empresa.id }, include: { usuario: true } }),
  ]);
  const nombreUsuario = (id: string | null) =>
    id ? miembros.find((m) => m.usuarioId === id)?.usuario.nombre ?? id.slice(-6) : 'sistema';

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Auditoría</h1>

      <form method="get" className="card p-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Entidad</label>
          <select name="entidad" defaultValue={searchParams.entidad ?? ''} className="input text-xs !w-auto">
            <option value="">Todas</option>
            {entidades.map((e) => (
              <option key={e.entidad} value={e.entidad}>{e.entidad}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Acción contiene</label>
          <input name="accion" defaultValue={searchParams.accion ?? ''} className="input text-xs !w-36" placeholder="VALIDAR" />
        </div>
        <div>
          <label className="label">Usuario</label>
          <select name="usuarioId" defaultValue={searchParams.usuarioId ?? ''} className="input text-xs !w-auto">
            <option value="">Todos</option>
            {miembros.map((m) => (
              <option key={m.usuarioId} value={m.usuarioId}>{m.usuario.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Desde</label>
          <input type="date" name="desde" defaultValue={searchParams.desde ?? ''} className="input text-xs" />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" name="hasta" defaultValue={searchParams.hasta ?? ''} className="input text-xs" />
        </div>
        <button className="btn-primary text-xs">Filtrar</button>
        <Link href={`/${params.empresaSlug}/auditoria`} className="btn-secondary text-xs">Limpiar</Link>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Acción</th><th>Antes</th><th>Después</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-slate-500">{formatFechaHora(l.createdAt)}</td>
                <td className="whitespace-nowrap">{nombreUsuario(l.usuarioId)}</td>
                <td className="whitespace-nowrap">
                  {l.entidad === 'Movimiento' ? (
                    <Link href={`/${params.empresaSlug}/validacion/${l.entidadId}`} className="underline">
                      {l.entidad}
                    </Link>
                  ) : (
                    l.entidad
                  )}
                  <span className="text-xs text-slate-400 ml-1">…{l.entidadId.slice(-6)}</span>
                </td>
                <td className="font-medium whitespace-nowrap">{l.accion}</td>
                <td className="max-w-[260px]">
                  <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all">
                    {l.antes != null ? JSON.stringify(l.antes).slice(0, 250) : '—'}
                  </pre>
                </td>
                <td className="max-w-[260px]">
                  <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all">
                    {l.despues != null ? JSON.stringify(l.despues).slice(0, 250) : '—'}
                  </pre>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">Sin registros para los filtros</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {logs.length === 300 && <p className="text-xs text-amber-600">Se muestran los últimos 300 registros; afiná los filtros.</p>}
    </div>
  );
}
