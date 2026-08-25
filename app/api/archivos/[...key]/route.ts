import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rolAlcanza } from '@/lib/roles';
import { getFileStorage } from '@/lib/storage';

// Serves stored originals. The storage key embeds the owning empresaId as its
// first segment; access requires membership in that company. Loaders can only
// see files of movements they created; validators+ see all of the company's.
export async function GET(_req: NextRequest, { params }: { params: { key: string[] } }) {
  const session = await auth();
  const usuarioId = (session?.user as { id?: string } | undefined)?.id;
  if (!usuarioId) return new NextResponse('No autenticado', { status: 401 });

  const key = params.key.map(decodeURIComponent).join('/');
  const empresaId = params.key[0];

  const membresia = await prisma.usuarioEmpresa.findFirst({ where: { usuarioId, empresaId } });
  if (!membresia) return new NextResponse('403 Forbidden', { status: 403 });

  const movimiento = await prisma.movimiento.findFirst({
    where: { empresaId, archivoKey: key },
    select: { archivoMime: true, archivoNombre: true, creadoPorId: true },
  });
  let archivo: { archivoMime: string | null; archivoNombre: string | null } | null = movimiento;
  if (movimiento) {
    if (!rolAlcanza(membresia.rol, 'VALIDADOR') && movimiento.creadoPorId !== usuarioId) {
      return new NextResponse('403 Forbidden', { status: 403 });
    }
  } else {
    // Recibos de sueldo comparten el mismo storage; son datos sensibles, sólo
    // ADMINISTRADOR los ve (misma restricción que las páginas de Empleados).
    const recibo = await prisma.reciboSueldo.findFirst({
      where: { empresaId, archivoKey: key },
      select: { archivoMime: true, archivoNombre: true },
    });
    if (!recibo) return new NextResponse('Archivo inexistente', { status: 404 });
    if (!rolAlcanza(membresia.rol, 'ADMINISTRADOR')) return new NextResponse('403 Forbidden', { status: 403 });
    archivo = recibo;
  }

  const storage = getFileStorage();
  if (!(await storage.exists(key))) return new NextResponse('Archivo inexistente', { status: 404 });
  const buffer = await storage.get(key);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': archivo!.archivoMime ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(archivo!.archivoNombre ?? 'archivo').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
