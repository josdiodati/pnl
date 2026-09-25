import type { NextRequest } from 'next/server';
import { ingestarRecibos } from '@/lib/empleados/ingesta';
import { DomainError } from '@/lib/errors';
import { conEmpresaJson } from '@/lib/subidas/ruta';

// Subida del PDF multi-recibo de sueldos. Ruta común y no server action: ver
// lib/subidas/ruta.ts.

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  const formData = await req.formData();
  return conEmpresaJson(params.empresaSlug, 'ADMINISTRADOR', async (ctx) => {
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) throw new DomainError('No se recibió el PDF.');
    if (archivo.type !== 'application/pdf') throw new DomainError('Los recibos se cargan como PDF.');
    if (archivo.size > MAX_BYTES) throw new DomainError('El PDF supera el máximo de 15 MB.');
    const { paginas } = await ingestarRecibos({
      empresaId: ctx.empresa.id,
      usuarioId: ctx.usuario.id,
      buffer: Buffer.from(await archivo.arrayBuffer()),
      filename: archivo.name,
      mime: archivo.type,
    });
    return { ok: true, paginas };
  });
}
