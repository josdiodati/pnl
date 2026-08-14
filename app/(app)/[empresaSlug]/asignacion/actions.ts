'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { asignarMovimiento } from '@/lib/movimientos/service';
import { guardarReglaDesdeAsignacion } from '@/lib/reglas/guardar-desde-asignacion';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';

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
  let mensajeRegla = '';

  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await asignarMovimiento(ctx, movimientoId, { categoriaId, lineas });

    // La regla es un extra opt-in: se guarda DESPUÉS de asignar y nunca deshace
    // la asignación si falla.
    if (formData.get('crearRegla') === '1') {
      const mov = await ctx.db.movimiento.findFirst({
        where: { id: movimientoId },
        include: { contraparte: true },
      });
      const resultado = await guardarReglaDesdeAsignacion(ctx, {
        cuit: mov?.cuitEmisor ?? null,
        razonSocial: mov ? nombreContraparte(mov).nombre : null,
        categoriaId,
        lineas,
        palabraClave: String(formData.get('reglaPalabraClave') ?? '').trim() || null,
        nombre: String(formData.get('reglaNombre') ?? '').trim() || null,
      });
      mensajeRegla = ` — ${resultado}`;
    }

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
  const ok = encodeURIComponent(`Movimiento asignado${mensajeRegla}`);
  redirect(siguienteId ? `/${slug}/asignacion/${siguienteId}?ok=${ok}` : `/${slug}/asignacion?ok=${ok}`);
}
