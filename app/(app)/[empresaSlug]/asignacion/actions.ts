'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { asignarMovimiento } from '@/lib/movimientos/service';
import { guardarReglaDesdeAsignacion } from '@/lib/reglas/guardar-desde-asignacion';
import { nombreContraparte, cuitContraparteDe } from '@/lib/movimientos/nombre-contraparte';
import { vincularMovimiento } from '@/lib/empleados/service';
import { esCategoriaAdicionalesSalario } from '@/lib/empleados/vinculos';
import { rolAlcanza } from '@/lib/roles';
import { parsearImporteAr } from '@/lib/format';
import { DomainError } from '@/lib/errors';

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
  let avisoRegla = '';

  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');

    // Adicional de salario con empleado elegido (sólo ADMINISTRADOR, como
    // toda la sección Empleados). El monto se valida ANTES de asignar para no
    // dejar el comprobante asignado sin su vínculo.
    let empleadoId = String(formData.get('empleadoId') ?? '') || null;
    let montoEmpleado: number | null = null;
    if (empleadoId) {
      const categoria = await ctx.db.categoria.findFirst({ where: { id: categoriaId } });
      if (!esCategoriaAdicionalesSalario(categoria?.nombre)) empleadoId = null; // cambió de categoría
      else if (!rolAlcanza(ctx.rol, 'ADMINISTRADOR')) throw new DomainError('Sólo un administrador puede vincular el comprobante a un empleado.');
      else {
        montoEmpleado = parsearImporteAr(String(formData.get('montoEmpleado') ?? '')) ?? null;
        if (montoEmpleado == null || !(montoEmpleado > 0)) throw new DomainError('Indicá el monto a vincular al empleado.');
      }
    }

    await asignarMovimiento(ctx, movimientoId, { categoriaId, lineas });
    if (empleadoId && montoEmpleado != null) {
      await vincularMovimiento(ctx, { movimientoId, empleadoId, monto: montoEmpleado });
    }

    // La regla es un extra opt-in: se guarda DESPUÉS de asignar y nunca deshace
    // la asignación si falla.
    if (formData.get('crearRegla') === '1') {
      const mov = await ctx.db.movimiento.findFirst({
        where: { id: movimientoId },
        include: { contraparte: true },
      });
      const resultado = await guardarReglaDesdeAsignacion(ctx, {
        cuit: mov ? cuitContraparteDe(mov) : null,
        razonSocial: mov ? nombreContraparte(mov).nombre : null,
        categoriaId,
        lineas,
        palabraClave: String(formData.get('reglaPalabraClave') ?? '').trim() || null,
        // Fuente y usuario elegidos en el atajo ('' = cualquiera); se validan al guardar.
        canal: String(formData.get('reglaCanal') ?? '') || null,
        cargadoPorId: String(formData.get('reglaCargadoPorId') ?? '') || null,
        nombre: String(formData.get('reglaNombre') ?? '').trim() || null,
        empleadoId,
      });
      if (resultado.ok) mensajeRegla = ` — ${resultado.mensaje}`;
      else avisoRegla = resultado.mensaje;
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
  const qs = `ok=${encodeURIComponent(`Movimiento asignado${mensajeRegla}`)}${avisoRegla ? `&aviso=${encodeURIComponent(avisoRegla)}` : ''}`;
  redirect(siguienteId ? `/${slug}/asignacion/${siguienteId}?${qs}` : `/${slug}/asignacion?${qs}`);
}
