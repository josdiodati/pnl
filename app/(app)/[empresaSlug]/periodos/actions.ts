'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { cerrarPeriodo, reabrirPeriodo } from '@/lib/movimientos/service';

// Cerrar y reabrir se hacen desde el detalle del mes: se vuelve ahí.
function volver(slug: string, anio: number, mes: number, err?: unknown, ok?: string): never {
  revalidatePath(`/${slug}/periodos`);
  const qs = new URLSearchParams();
  if (err) {
    if (isDomainError(err) || isForbidden(err)) qs.set('error', err.message);
    else throw err;
  }
  if (ok) qs.set('ok', ok);
  redirect(`/${slug}/periodos/${anio}-${String(mes).padStart(2, '0')}${qs.size ? `?${qs}` : ''}`);
}

// Closing: VALIDADOR+. Blocked while the month still has pending/observed
// movements (the detail page lists them).
export async function cerrarPeriodoAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const anio = Number(formData.get('anio'));
  const mes = Number(formData.get('mes'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await cerrarPeriodo(ctx, anio, mes);
  } catch (err) {
    volver(slug, anio, mes, err);
  }
  volver(slug, anio, mes, undefined, 'Período cerrado');
}

// Reopening: ADMINISTRADOR only, with a mandatory audited reason.
export async function reabrirPeriodoAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const anio = Number(formData.get('anio'));
  const mes = Number(formData.get('mes'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await reabrirPeriodo(ctx, anio, mes, String(formData.get('motivo') ?? ''));
  } catch (err) {
    volver(slug, anio, mes, err);
  }
  volver(slug, anio, mes, undefined, 'Período reabierto');
}
