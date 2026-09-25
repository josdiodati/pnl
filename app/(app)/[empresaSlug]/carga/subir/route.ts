import type { NextRequest } from 'next/server';
import { ingestarComprobante } from '@/lib/pipeline';
import { conEmpresaJson, archivosDe } from '@/lib/subidas/ruta';

// Subida de comprobantes (UploadZone). Ruta común y no server action: ver
// lib/subidas/ruta.ts. Un drop del usuario = un LoteIngesta, aunque lleguen en
// tandas: la primera tanda crea el lote (con el total esperado) y las
// siguientes lo referencian. El loteId del cliente se verifica contra la
// empresa activa: nunca se confía en un id ajeno.

const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;

export type SubirResultado = { ok: number; errores: string[]; loteId?: string };

export async function POST(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  const formData = await req.formData();
  return conEmpresaJson(params.empresaSlug, 'CARGADOR', async (ctx): Promise<SubirResultado> => {
    const canal = String(formData.get('canal')) === 'FOTO' ? 'FOTO' : 'WEB';
    const archivos = archivosDe(formData, 'archivos');
    if (!archivos.length) return { ok: 0, errores: ['No se recibió ningún archivo.'] };

    const loteIdCliente = String(formData.get('loteId') ?? '');
    const totalLote = Number(formData.get('totalLote') ?? archivos.length);
    let loteId: string | undefined;
    if (loteIdCliente) {
      const lote = await ctx.db.loteIngesta.findFirst({ where: { id: loteIdCliente }, select: { id: true } });
      loteId = lote?.id;
    }
    if (!loteId) {
      const lote = await ctx.db.loteIngesta.create({
        data: {
          canal,
          creadoPorId: ctx.usuario.id,
          archivos: Number.isFinite(totalLote) && totalLote > 0 ? totalLote : archivos.length,
        } as never,
      });
      loteId = lote.id;
    }

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
          loteId,
        });
        ok++;
      } catch (err) {
        errores.push(`${archivo.name}: ${err instanceof Error ? err.message : 'error inesperado'}`);
      }
    }
    return { ok, errores, loteId };
  });
}
