'use server';

import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { ingestarComprobante } from '@/lib/pipeline';

const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;

export type SubirResultado = { ok: number; errores: string[] };

/**
 * Receives one or many files (drag & drop or phone camera) and pushes each one
 * into the ingestion pipeline as its own voucher (1 file = 1 voucher, MVP).
 */
export async function subirComprobantesAction(formData: FormData): Promise<SubirResultado> {
  const slug = String(formData.get('empresaSlug'));
  const canal = String(formData.get('canal')) === 'FOTO' ? 'FOTO' : 'WEB';
  try {
    const ctx = await requireEmpresa(slug, 'CARGADOR');
    const archivos = formData.getAll('archivos').filter((f): f is File => f instanceof File && f.size > 0);
    if (!archivos.length) return { ok: 0, errores: ['No se recibió ningún archivo.'] };

    let ok = 0;
    const errores: string[] = [];
    for (const archivo of archivos) {
      if (!MIMES.has(archivo.type)) {
        errores.push(`${archivo.name}: formato no soportado (PDF, JPG, PNG o WEBP).`);
        continue;
      }
      if (archivo.size > MAX_BYTES) {
        errores.push(`${archivo.name}: supera el máximo de 15 MB.`);
        continue;
      }
      try {
        await ingestarComprobante({
          empresaId: ctx.empresa.id,
          usuarioId: ctx.usuario.id,
          buffer: Buffer.from(await archivo.arrayBuffer()),
          filename: archivo.name,
          mime: archivo.type,
          canal,
        });
        ok++;
      } catch (err) {
        errores.push(`${archivo.name}: ${err instanceof Error ? err.message : 'error inesperado'}`);
      }
    }
    return { ok, errores };
  } catch (err) {
    if (isForbidden(err) || isDomainError(err)) return { ok: 0, errores: [err.message] };
    throw err;
  }
}
