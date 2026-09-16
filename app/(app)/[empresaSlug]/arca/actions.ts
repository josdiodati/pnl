'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { importarMisComprobantes, encolarSyncManual } from '@/lib/arca/mis-comprobantes/service';

// Pantalla ARCA · Mis Comprobantes: importar el CSV/ZIP bajado a mano del
// portal y disparar una sincronización (el worker la corre con UN login).

const MAX_BYTES = 20 * 1024 * 1024;

function volverConError(slug: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) redirect(`/${slug}/arca?error=${encodeURIComponent(err.message)}`);
  throw err;
}

export async function importarCsvArcaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  let mensaje = '';
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) throw Object.assign(new Error('Elegí el CSV o el ZIP que bajaste de Mis Comprobantes.'), { name: 'DomainError' });
    if (archivo.size > MAX_BYTES) throw Object.assign(new Error('El archivo supera los 20 MB.'), { name: 'DomainError' });
    const r = await importarMisComprobantes(ctx, { contenido: Buffer.from(await archivo.arrayBuffer()), nombreArchivo: archivo.name });
    mensaje = `${r.origen === 'EMITIDO' ? 'Emitidos' : 'Recibidos'}: ${r.filas} comprobantes leídos, ${r.nuevos} nuevos, ${r.actualizados} ya conocidos, ${r.cruzados} cruzados con el libro.`;
  } catch (err) {
    if (err instanceof Error && err.name === 'DomainError') redirect(`/${slug}/arca?error=${encodeURIComponent(err.message)}`);
    volverConError(slug, err);
  }
  redirect(`/${slug}/arca?ok=${encodeURIComponent(mensaje)}`);
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
