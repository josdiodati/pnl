import type { NextRequest } from 'next/server';
import { ingestarResumen } from '@/lib/resumenes/ingesta';
import { conEmpresaJson, archivosDe } from '@/lib/subidas/ruta';

// Subida de resúmenes de tarjeta/banco. Ruta común y no server action: ver
// lib/subidas/ruta.ts. Ni tipo ni emisor se piden: los declara el PDF.

const MAX_BYTES = 15 * 1024 * 1024;

export type SubirResumenesResultado = { ok: number; errores: string[] };

export async function POST(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  const formData = await req.formData();
  return conEmpresaJson(params.empresaSlug, 'VALIDADOR', async (ctx): Promise<SubirResumenesResultado> => {
    const archivos = archivosDe(formData, 'archivos');
    if (!archivos.length) return { ok: 0, errores: ['No se recibió ningún PDF.'] };
    let ok = 0;
    const errores: string[] = [];
    for (const archivo of archivos) {
      if (archivo.type !== 'application/pdf') {
        errores.push(`${archivo.name}: los resúmenes se cargan como PDF.`);
        continue;
      }
      if (archivo.size > MAX_BYTES) {
        errores.push(`${archivo.name}: supera el máximo de 15 MB.`);
        continue;
      }
      try {
        await ingestarResumen({
          empresaId: ctx.empresa.id,
          usuarioId: ctx.usuario.id,
          buffer: Buffer.from(await archivo.arrayBuffer()),
          filename: archivo.name,
          mime: archivo.type,
        });
        ok++;
      } catch (err) {
        errores.push(`${archivo.name}: ${err instanceof Error ? err.message : 'error inesperado'}`);
      }
    }
    return { ok, errores };
  });
}
