'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { parsearImporteAr } from '@/lib/format';
import {
  registrarCobro,
  eliminarCobroGrupo,
  cerrarSaldoComoRetencion,
  acreditarCheque,
  rechazarCheque,
  fijarFechaProbable,
} from '@/lib/cobranzas/service';

// Actions de cobranzas (Spec F): exigen VALIDADOR, como la conciliación.
// Vuelven a `volver` (ruta relativa a la empresa) con ?ok= o ?error=.

function destino(slug: string, volver: string, clave: 'ok' | 'error', msg: string): string {
  const path = volver.replace(/^\/+/, '') || 'ventas';
  return `/${slug}/${path}${path.includes('?') ? '&' : '?'}${clave}=${encodeURIComponent(msg)}`;
}

function volverConError(slug: string, volver: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) redirect(destino(slug, volver, 'error', err.message));
  throw err;
}

const fecha = (v: FormDataEntryValue | null | undefined): Date => new Date(`${String(v ?? '')}T00:00:00Z`);

export async function registrarCobroAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const volver = String(formData.get('volver') ?? 'ventas');
  const errorEn = String(formData.get('errorEn') ?? volver);
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const tipos = formData.getAll('ins_tipo').map(String);
    const montos = formData.getAll('ins_monto').map((v) => parsearImporteAr(String(v)));
    const monedas = formData.getAll('ins_moneda').map(String);
    const fechas = formData.getAll('ins_fecha');
    const acreditaciones = formData.getAll('ins_acreditacion');
    const numeros = formData.getAll('ins_numero').map(String);
    const bancos = formData.getAll('ins_banco').map(String);
    const instrumentos = tipos
      .map((instrumento, i) => ({
        instrumento,
        monto: montos[i] as number,
        moneda: monedas[i] || 'ARS',
        fecha: fecha(fechas[i]),
        fechaAcreditacion: fecha(acreditaciones[i] || fechas[i]),
        numero: numeros[i] || null,
        banco: bancos[i] || null,
      }))
      .filter((x) => x.monto != null && !Number.isNaN(x.monto));
    const cot = parsearImporteAr(String(formData.get('cotizacion') ?? ''));
    await registrarCobro(ctx, {
      ventaIds: formData.getAll('ventaId').map(String),
      instrumentos,
      cotizacion: cot != null && cot > 0 ? cot : null,
      cerrarDiferenciaComoRetencion: formData.get('cerrarRetencion') === 'on',
      nota: String(formData.get('nota') ?? '') || null,
    });
  } catch (err) {
    volverConError(slug, errorEn, err);
  }
  revalidatePath(`/${slug}/ventas`);
  redirect(destino(slug, volver, 'ok', 'Cobro registrado.'));
}

export async function eliminarCobroAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const volver = String(formData.get('volver') ?? 'ventas');
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await eliminarCobroGrupo(ctx, String(formData.get('grupo')));
  } catch (err) {
    volverConError(slug, volver, err);
  }
  redirect(destino(slug, volver, 'ok', 'Cobro eliminado.'));
}

export async function cerrarRetencionAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const volver = String(formData.get('volver') ?? 'ventas');
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await cerrarSaldoComoRetencion(ctx, String(formData.get('ventaId')));
  } catch (err) {
    volverConError(slug, volver, err);
  }
  redirect(destino(slug, volver, 'ok', 'Saldo cerrado como retención.'));
}

export async function acreditarChequeAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const volver = String(formData.get('volver') ?? 'cobranzas');
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const f = String(formData.get('fecha') ?? '');
    await acreditarCheque(ctx, String(formData.get('cobroId')), f ? fecha(f) : undefined);
  } catch (err) {
    volverConError(slug, volver, err);
  }
  redirect(destino(slug, volver, 'ok', 'Cheque acreditado.'));
}

export async function rechazarChequeAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const volver = String(formData.get('volver') ?? 'cobranzas');
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await rechazarCheque(ctx, String(formData.get('cobroId')), String(formData.get('motivo') ?? '') || undefined);
  } catch (err) {
    volverConError(slug, volver, err);
  }
  redirect(destino(slug, volver, 'ok', 'Cheque marcado como rechazado: la factura vuelve a deberse.'));
}

/** Desde la celda de la tabla (componente cliente): sin redirect. */
export async function fijarFechaProbableAction(slug: string, ventaId: string, fechaIso: string | null): Promise<{ error?: string }> {
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await fijarFechaProbable(ctx, ventaId, fechaIso ? fecha(fechaIso) : null);
  } catch (err) {
    if (isDomainError(err) || isForbidden(err)) return { error: err.message };
    throw err;
  }
  revalidatePath(`/${slug}/ventas`);
  revalidatePath(`/${slug}/cobranzas`);
  return {};
}
