import { redirect } from 'next/navigation';
import { requireEmpresa, requireEmpresaPage, type EmpresaContext } from '@/lib/empresa/require-empresa';
import { ForbiddenError } from '@/lib/errors';
import { CATALOGO, type ReportePersonalizado } from './catalogo';
import { puedeVerReporte } from './habilitaciones';

// Acceso a reportes personalizados: lo usan el menú, el índice y cada página.

async function habilitadosDe(ctx: EmpresaContext): Promise<Set<string>> {
  // ctx.db ya filtra por la empresa actual.
  const filas = await ctx.db.reporteHabilitado.findMany({
    where: { usuarioId: ctx.usuario.id },
    select: { reporteId: true },
  });
  return new Set(filas.map((f) => f.reporteId));
}

/** Reportes que el usuario ve en esta empresa, en el orden del catálogo. */
export async function reportesVisibles(ctx: EmpresaContext): Promise<ReportePersonalizado[]> {
  const habilitados = await habilitadosDe(ctx);
  return CATALOGO.filter((r) => puedeVerReporte(r.id, ctx.rol, habilitados));
}

/** Guard de página: membresía + reporte habilitado + rol mínimo; si no, pantalla 403. */
export async function requireReportePage(empresaSlug: string, reporteId: string): Promise<EmpresaContext> {
  const ctx = await requireEmpresaPage(empresaSlug);
  if (!puedeVerReporte(reporteId, ctx.rol, await habilitadosDe(ctx))) redirect('/403');
  return ctx;
}

/** Guard de route handler (exportables): igual que la página, pero tira ForbiddenError (HTTP 403). */
export async function requireReporte(empresaSlug: string, reporteId: string): Promise<EmpresaContext> {
  const ctx = await requireEmpresa(empresaSlug);
  if (!puedeVerReporte(reporteId, ctx.rol, await habilitadosDe(ctx))) throw new ForbiddenError();
  return ctx;
}
