'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { encolarSyncManual, ignorarComprobanteArca, dejarDeIgnorarComprobanteArca } from '@/lib/arca/mis-comprobantes/service';

// Pantalla ARCA · Mis Comprobantes: disparar una sincronización (el worker la
// corre con UN login). El CSV/ZIP se importa por la ruta ./importar.


function volverConError(slug: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) redirect(`/${slug}/arca?error=${encodeURIComponent(err.message)}`);
  throw err;
}

export async function sincronizarArcaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await encolarSyncManual(ctx);
  } catch (err) {
    volverConError(slug, err);
  }
  redirect(`/${slug}/arca?ok=${encodeURIComponent('Sincronización encolada: el worker entra a ARCA con un único login y baja los últimos 30 días.')}`);
}

/** Vuelve a la misma vista (mes y filtros) desde la que se ignoró. */
function volverA(slug: string, formData: FormData, ok: string): never {
  const base = `/${slug}/arca`;
  const volver = String(formData.get('volver') ?? '');
  const destino = volver.startsWith(`${base}?`) ? volver : `${base}?`;
  redirect(`${destino}&ok=${encodeURIComponent(ok)}`);
}

export async function ignorarArcaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await ignorarComprobanteArca(ctx, String(formData.get('id')), String(formData.get('motivo') ?? ''));
  } catch (err) {
    volverConError(slug, err);
  }
  volverA(slug, formData, 'Comprobante ignorado: cuenta como resuelto para el cumplimiento.');
}

export async function dejarDeIgnorarArcaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await dejarDeIgnorarComprobanteArca(ctx, String(formData.get('id')));
  } catch (err) {
    volverConError(slug, err);
  }
  volverA(slug, formData, 'El comprobante vuelve a figurar como faltante.');
}
