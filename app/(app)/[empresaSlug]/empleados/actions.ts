'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { ingestarRecibos } from '@/lib/empleados/ingesta';
import {
  confirmarRecibo, anularRecibo, guardarFichaEmpleado, guardarDistribucionEmpleado,
  vincularMovimiento, desvincularMovimiento,
} from '@/lib/empleados/service';
import type { TotalesRecibo } from '@/lib/empleados/aritmetica';

// Todas las actions de Empleados exigen ADMINISTRADOR: los sueldos son datos
// sensibles y esta es la primera sección con restricción por rol.

const MAX_BYTES = 15 * 1024 * 1024;

function leerLineas(formData: FormData) {
  const ccIds = formData.getAll('linea_centroCostoId').map(String);
  const cliIds = formData.getAll('linea_clienteId').map(String);
  const prIds = formData.getAll('linea_proyectoId').map(String);
  const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
  return ccIds
    .map((cc, i) => ({ centroCostoId: cc, clienteId: cliIds[i] || null, proyectoId: prIds[i] || null, porcentaje: pcts[i] }))
    .filter((l) => l.centroCostoId);
}

function numeroOpcional(formData: FormData, name: string): number | undefined {
  const v = formData.get(name);
  if (v == null || String(v).trim() === '') return undefined;
  return Number(String(v).replace(/\./g, '').replace(',', '.'));
}

function volverConError(slug: string, path: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) {
    redirect(`/${slug}/${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function subirRecibosAction(formData: FormData): Promise<{ ok: boolean; paginas?: number; error?: string }> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'No se recibió el PDF.' };
    if (archivo.type !== 'application/pdf') return { ok: false, error: 'Los recibos se cargan como PDF.' };
    if (archivo.size > MAX_BYTES) return { ok: false, error: 'El PDF supera el máximo de 15 MB.' };
    const { paginas } = await ingestarRecibos({
      empresaId: ctx.empresa.id,
      usuarioId: ctx.usuario.id,
      buffer: Buffer.from(await archivo.arrayBuffer()),
      filename: archivo.name,
      mime: archivo.type,
    });
    return { ok: true, paginas };
  } catch (err) {
    if (isForbidden(err) || isDomainError(err)) return { ok: false, error: err.message };
    throw err;
  }
}

export async function confirmarReciboAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const reciboId = String(formData.get('reciboId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const totales: Partial<TotalesRecibo> = {
      brutoRemunerativo: numeroOpcional(formData, 'brutoRemunerativo'),
      noRemunerativo: numeroOpcional(formData, 'noRemunerativo'),
      retenciones: numeroOpcional(formData, 'retenciones'),
      sueldoNeto: numeroOpcional(formData, 'sueldoNeto'),
      contribucionesEmpleador: numeroOpcional(formData, 'contribucionesEmpleador'),
      costoTotalEmpleador: numeroOpcional(formData, 'costoTotalEmpleador'),
    };
    await confirmarRecibo(ctx, reciboId, { lineas: leerLineas(formData), totales });
  } catch (err) {
    volverConError(slug, `empleados/recibos/${reciboId}`, err);
  }
  redirect(`/${slug}/empleados?tab=pendientes&ok=${encodeURIComponent('Recibo confirmado')}`);
}

export async function anularReciboAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const reciboId = String(formData.get('reciboId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await anularRecibo(ctx, reciboId, String(formData.get('nota') ?? ''));
  } catch (err) {
    volverConError(slug, `empleados/recibos/${reciboId}`, err);
  }
  redirect(`/${slug}/empleados?ok=${encodeURIComponent('Recibo anulado')}`);
}

export async function guardarFichaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await guardarFichaEmpleado(ctx, empleadoId, {
      nombre: String(formData.get('nombre') ?? ''),
      legajo: String(formData.get('legajo') ?? '') || null,
      categoria: String(formData.get('categoria') ?? '') || null,
      sector: String(formData.get('sector') ?? '') || null,
      fechaEgreso: String(formData.get('fechaEgreso') ?? '') || null,
      activo: formData.get('activo') === '1',
    });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Ficha guardada')}`);
}

export async function guardarDistribucionAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await guardarDistribucionEmpleado(ctx, empleadoId, leerLineas(formData));
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Distribución guardada')}`);
}

export async function vincularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await vincularMovimiento(ctx, {
      movimientoId: String(formData.get('movimientoId')),
      empleadoId,
      monto: numeroOpcional(formData, 'monto') ?? 0,
    });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Comprobante vinculado')}`);
}

export async function desvincularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await desvincularMovimiento(ctx, { movimientoId: String(formData.get('movimientoId')), empleadoId });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Vínculo eliminado')}`);
}
