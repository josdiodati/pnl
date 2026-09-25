import type { NextRequest } from 'next/server';
import { getFileStorage } from '@/lib/storage';
import { DomainError } from '@/lib/errors';
import { conEmpresaJson } from '@/lib/subidas/ruta';

// Adjunto de un asiento/venta manual: el navegador lo sube acá primero (ruta
// común, ver lib/subidas/ruta.ts) y el formulario manda sólo la referencia.
// El almacén es inmutable: un adjunto que después no se usa queda huérfano,
// igual que antes cuando un formulario fallaba después de guardar el archivo.

const MAX_BYTES = 15 * 1024 * 1024;

export type AdjuntoSubido = { key: string; nombre: string; mime: string; hash: string };

export async function POST(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  const formData = await req.formData();
  return conEmpresaJson(params.empresaSlug, 'CARGADOR', async (ctx): Promise<AdjuntoSubido> => {
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) throw new DomainError('No se recibió el adjunto.');
    if (archivo.size > MAX_BYTES) throw new DomainError('El adjunto supera 15 MB.');
    const mime = archivo.type || 'application/octet-stream';
    const { key, hash } = await getFileStorage().put(Buffer.from(await archivo.arrayBuffer()), {
      filename: archivo.name,
      mime,
      empresaId: ctx.empresa.id,
    });
    return { key, nombre: archivo.name, mime, hash };
  });
}
