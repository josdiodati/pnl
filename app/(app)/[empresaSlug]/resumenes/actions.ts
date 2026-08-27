'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { parsearImporteAr } from '@/lib/format';
import { ingestarResumen, rematchearResumen } from '@/lib/resumenes/ingesta';
import { conciliarLinea, imputarLinea, ignorarLinea, deshacerLinea, rechazarCandidato } from '@/lib/resumenes/service';

// Actions de Resúmenes: exigen VALIDADOR (misma frontera que Validación /
// Asignación). Contrato de FormData documentado en el brief — Task 7 (bandeja
// de conciliación) construye los <form> contra estas mismas actions.

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
  if (v == null) return undefined;
  return parsearImporteAr(String(v));
}

function volverConError(slug: string, path: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) {
    redirect(`/${slug}/${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function subirResumenAction(formData: FormData): Promise<{ ok: boolean; resumenId?: string; error?: string }> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'No se recibió el PDF.' };
    if (archivo.type !== 'application/pdf') return { ok: false, error: 'Los resúmenes se cargan como PDF.' };
    if (archivo.size > MAX_BYTES) return { ok: false, error: 'El PDF supera el máximo de 15 MB.' };
    const tipo = String(formData.get('tipo') ?? '');
    if (tipo !== 'TARJETA' && tipo !== 'BANCO') return { ok: false, error: 'Elegí el tipo de resumen.' };
    const emisor = String(formData.get('emisor') ?? '');
    const { resumenId } = await ingestarResumen({
      empresaId: ctx.empresa.id,
      usuarioId: ctx.usuario.id,
      buffer: Buffer.from(await archivo.arrayBuffer()),
      filename: archivo.name,
      mime: archivo.type,
      tipo,
      emisor,
    });
    return { ok: true, resumenId };
  } catch (err) {
    if (isForbidden(err) || isDomainError(err)) return { ok: false, error: err.message };
    throw err;
  }
}

export async function conciliarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await conciliarLinea(ctx, {
      lineaId: String(formData.get('lineaId')),
      movimientoId: String(formData.get('movimientoId')),
    });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Línea conciliada')}`);
}

export async function imputarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await imputarLinea(ctx, {
      lineaId: String(formData.get('lineaId')),
      categoriaId: String(formData.get('categoriaId')),
      lineas: leerLineas(formData),
      contraparteId: String(formData.get('contraparteId') ?? '') || null,
      montoArs: numeroOpcional(formData, 'montoArs') ?? null,
    });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Línea imputada')}`);
}

export async function ignorarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await ignorarLinea(ctx, {
      lineaId: String(formData.get('lineaId')),
      motivo: String(formData.get('motivo') ?? ''),
    });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Línea ignorada')}`);
}

export async function deshacerAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await deshacerLinea(ctx, { lineaId: String(formData.get('lineaId')) });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Deshecho')}`);
}

/** Rechaza una sugerencia (candidato) de una línea: no se vuelve a proponer. */
export async function rechazarCandidatoAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  const lineaId = String(formData.get('lineaId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await rechazarCandidato(ctx, { lineaId, movimientoId: String(formData.get('movimientoId')) });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}?linea=${lineaId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?linea=${lineaId}&ok=${encodeURIComponent('Sugerencia rechazada')}`);
}

export async function rematchearAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await rematchearResumen(ctx.db, resumenId);
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Matching recalculado')}`);
}

/** Concilia de un saque todas las líneas SUGERIDA con su primer candidato. Tolera fallos por línea. */
export async function confirmarSugeridasAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  let mensaje = '';
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const lineas = await ctx.db.resumenLinea.findMany({ where: { resumenId, estado: 'SUGERIDA' } });
    let ok = 0;
    let fallidas = 0;
    for (const l of lineas) {
      const candidatos = (l.candidatos as { movimientoId: string; rechazado?: boolean }[] | null) ?? [];
      const primero = candidatos.find((c) => !c.rechazado);
      if (!primero) {
        fallidas++;
        continue;
      }
      try {
        await conciliarLinea(ctx, { lineaId: l.id, movimientoId: primero.movimientoId });
        ok++;
      } catch {
        fallidas++;
      }
    }
    mensaje = `${ok} línea${ok !== 1 ? 's' : ''} conciliada${ok !== 1 ? 's' : ''}${fallidas > 0 ? `, ${fallidas} fallida${fallidas !== 1 ? 's' : ''}` : ''}`;
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent(mensaje)}`);
}
