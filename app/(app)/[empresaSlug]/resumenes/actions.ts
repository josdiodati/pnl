'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { parsearImporteAr } from '@/lib/format';
import { ingestarResumen, rematchearResumen } from '@/lib/resumenes/ingesta';
import {
  conciliarLinea,
  imputarLinea,
  ignorarLinea,
  deshacerLinea,
  rechazarCandidato,
  editarLinea,
  desvincularLinea,
  eliminarResumen,
  confirmarTitularResumen,
} from '@/lib/resumenes/service';
import { aplicarReglasResumen, crearReglaDesdeLinea } from '@/lib/resumenes/reglas';

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

export type SubirResumenesResultado = { ok: number; errores: string[] };

/**
 * Recibe uno o varios PDFs de resumen. Ni el tipo (tarjeta/banco) ni el emisor
 * se piden: los declara el propio PDF y los completa la extracción.
 */
export async function subirResumenAction(formData: FormData): Promise<SubirResumenesResultado> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const archivos = formData.getAll('archivos').filter((f): f is File => f instanceof File && f.size > 0);
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
  } catch (err) {
    if (isForbidden(err) || isDomainError(err)) return { ok: 0, errores: [err.message] };
    throw err;
  }
}

/**
 * Vincula un comprobante a la línea. `confirmarCompartido` (checkbox) es
 * obligatorio cuando el comprobante ya está vinculado a otra línea (se pagó en
 * varios movimientos). Una línea CONCILIADA suma otro comprobante.
 */
export async function conciliarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  const lineaId = String(formData.get('lineaId'));
  // Desde el panel de la línea se vuelve al panel; desde la lista, a la lista.
  const volverA = formData.get('volverAlPanel') ? `resumenes/${resumenId}?linea=${lineaId}` : `resumenes/${resumenId}`;
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await conciliarLinea(ctx, {
      lineaId,
      movimientoId: String(formData.get('movimientoId')),
      confirmarCompartido: Boolean(formData.get('confirmarCompartido')),
    });
  } catch (err) {
    volverConError(slug, volverA, err);
  }
  redirect(`/${slug}/${volverA}${volverA.includes('?') ? '&' : '?'}ok=${encodeURIComponent('Comprobante vinculado a la línea')}`);
}

/** Quita un comprobante de una línea conciliada (sin comprobantes vuelve a pendiente). */
export async function desvincularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  const lineaId = String(formData.get('lineaId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await desvincularLinea(ctx, { lineaId, movimientoId: String(formData.get('movimientoId')) });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}?linea=${lineaId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?linea=${lineaId}&ok=${encodeURIComponent('Comprobante desvinculado')}`);
}

/** Confirma a mano que un resumen marcado como de otra empresa sí es de esta. */
export async function confirmarTitularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await confirmarTitularResumen(ctx, { resumenId });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent('Resumen confirmado como de esta empresa')}`);
}

/**
 * Borra un resumen (doble validación: el usuario escribe ELIMINAR y el
 * servicio lo revalida). Sólo sin comprobantes vinculados.
 */
export async function eliminarResumenAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await eliminarResumen(ctx, { resumenId, confirmacion: String(formData.get('confirmacion') ?? '') });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes?ok=${encodeURIComponent('Resumen eliminado')}`);
}

export async function imputarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  let mensaje = 'Línea imputada';
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const lineaId = String(formData.get('lineaId'));
    const categoriaId = String(formData.get('categoriaId'));
    const lineas = leerLineas(formData);
    await imputarLinea(ctx, {
      lineaId,
      categoriaId,
      lineas,
      contraparteId: String(formData.get('contraparteId') ?? '') || null,
      montoArs: numeroOpcional(formData, 'montoArs') ?? null,
    });
    if (formData.get('crearRegla')) {
      // La regla guarda un centro único (línea 100%): con distribución múltiple no se crea.
      if (lineas.length === 1 && lineas[0].porcentaje === 100) {
        const r = await crearReglaDesdeLinea(ctx.db, {
          lineaId,
          accion: 'IMPUTAR',
          categoriaId,
          centroCostoId: lineas[0].centroCostoId,
          clienteId: lineas[0].clienteId,
          proyectoId: lineas[0].proyectoId,
        });
        mensaje += r.creada ? ` · regla «${r.nombre}» creada` : ` · ya existía una regla «${r.nombre}»`;
      } else {
        mensaje += ' · la regla no se creó (distribución múltiple: creala en Maestros con una plantilla)';
      }
    }
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent(mensaje)}`);
}

export async function ignorarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  let mensaje = 'Línea ignorada';
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const lineaId = String(formData.get('lineaId'));
    // Los chips de motivo rápido mandan `motivoRapido` (botones con value); el texto libre, `motivo`.
    const motivo = String(formData.get('motivoRapido') ?? '') || String(formData.get('motivo') ?? '');
    const centroCostoId = String(formData.get('centroCostoId') ?? '') || null;
    await ignorarLinea(ctx, { lineaId, motivo, centroCostoId });
    if (formData.get('crearRegla')) {
      const r = await crearReglaDesdeLinea(ctx.db, { lineaId, accion: 'IGNORAR', motivo: motivo.trim() });
      mensaje += r.creada ? ` · regla «${r.nombre}» creada` : ` · ya existía una regla «${r.nombre}»`;
    }
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent(mensaje)}`);
}

/** Corrige a mano los datos capturados de una línea (falla del OCR/extracción). */
export async function editarLineaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  const lineaId = String(formData.get('lineaId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const fechaTexto = String(formData.get('fecha') ?? '').trim();
    await editarLinea(ctx, {
      lineaId,
      descriptor: String(formData.get('descriptor') ?? ''),
      fecha: fechaTexto ? new Date(`${fechaTexto}T00:00:00Z`) : null,
      monto: numeroOpcional(formData, 'monto') ?? null,
      moneda: String(formData.get('moneda') ?? 'ARS'),
      montoOrigen: numeroOpcional(formData, 'montoOrigen') ?? null,
      cuotas: String(formData.get('cuotas') ?? ''),
      cuenta: String(formData.get('cuenta') ?? ''),
      titular: String(formData.get('titular') ?? ''),
    });
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}?linea=${lineaId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?linea=${lineaId}&ok=${encodeURIComponent('Línea corregida')}`);
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

/** Aplica las reglas de resumen a las líneas no resueltas (botón "Aplicar reglas"). */
export async function aplicarReglasAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const resumenId = String(formData.get('resumenId'));
  let mensaje = '';
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const r = await aplicarReglasResumen(ctx.db, resumenId, ctx.usuario.id);
    mensaje = `Reglas aplicadas: ${r.ignoradas} ignorada${r.ignoradas !== 1 ? 's' : ''}, ${r.imputadas} imputada${r.imputadas !== 1 ? 's' : ''}`;
  } catch (err) {
    volverConError(slug, `resumenes/${resumenId}`, err);
  }
  redirect(`/${slug}/resumenes/${resumenId}?ok=${encodeURIComponent(mensaje)}`);
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
