'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { asignarMovimiento } from '@/lib/movimientos/service';

function leerLineas(formData: FormData) {
  const ccIds = formData.getAll('linea_centroCostoId').map(String);
  const cliIds = formData.getAll('linea_clienteId').map(String);
  const prIds = formData.getAll('linea_proyectoId').map(String);
  const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
  return ccIds
    .map((cc, i) => ({ centroCostoId: cc, clienteId: cliIds[i] || null, proyectoId: prIds[i] || null, porcentaje: pcts[i] }))
    .filter((l) => l.centroCostoId);
}

function volverConError(slug: string, movimientoId: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) {
    redirect(`/${slug}/asignacion/${movimientoId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function asignarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  const categoriaId = String(formData.get('categoriaId'));
  const irAlSiguiente = formData.get('siguiente') === '1';
  const lineas = leerLineas(formData);
  let siguienteId: string | null = null;

  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await asignarMovimiento(ctx, movimientoId, { categoriaId, lineas });

    if (irAlSiguiente) {
      const siguiente = await ctx.db.movimiento.findFirst({
        where: { estado: 'VALIDADO', id: { not: movimientoId } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      siguienteId = siguiente?.id ?? null;
    }
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  revalidatePath(`/${slug}/asignacion`);
  redirect(siguienteId ? `/${slug}/asignacion/${siguienteId}` : `/${slug}/asignacion?ok=Movimiento+asignado`);
}
