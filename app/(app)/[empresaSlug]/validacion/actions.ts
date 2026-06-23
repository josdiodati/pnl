'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden, DomainError } from '@/lib/errors';
import {
  validarMovimiento,
  observarMovimiento,
  anularMovimiento,
  volverAPendiente,
  reintentarExtraccion,
  cargarAManoDesdeError,
} from '@/lib/movimientos/service';
import { procesarArca } from '@/lib/pipeline';
import { cuitEsValido, normalizarCuit } from '@/lib/checks';
import { writeAudit } from '@/lib/audit';
import type { Moneda } from '@prisma/client';

function aNumero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

// Imputación opcional cargada en la misma pantalla de validación.
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
    redirect(`/${slug}/validacion/${movimientoId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function validarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  const irAlSiguiente = formData.get('siguiente') === '1';
  let siguienteId: string | null = null;

  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');

    // Optional inline creation of a new contraparte without leaving the screen
    let contraparteId = String(formData.get('contraparteId') ?? '') || null;
    if (contraparteId === '__nueva__') {
      const cuit = normalizarCuit(String(formData.get('nuevaContraparte_cuit') ?? ''));
      const razonSocial = String(formData.get('nuevaContraparte_razonSocial') ?? '').trim();
      const tipo = (String(formData.get('nuevaContraparte_tipo') ?? 'PROVEEDOR')) as 'PROVEEDOR' | 'CLIENTE' | 'AMBOS';
      if (!razonSocial) throw new DomainError('Ingresá la razón social de la contraparte nueva.');
      if (!cuitEsValido(cuit)) throw new DomainError('El CUIT de la contraparte nueva es inválido.');
      const existente = await ctx.db.contraparte.findFirst({ where: { cuit } });
      if (existente) {
        contraparteId = existente.id;
      } else {
        const creada = await ctx.db.contraparte.create({ data: { cuit, razonSocial, tipo } as never });
        await writeAudit(ctx.db, {
          usuarioId: ctx.usuario.id,
          entidad: 'Contraparte',
          entidadId: creada.id,
          accion: 'CREAR',
          despues: { cuit, razonSocial, tipo, desdeValidacion: true },
        });
        contraparteId = creada.id;
      }
    }

    await validarMovimiento(ctx, movimientoId, {
      fechaDevengamiento: String(formData.get('fechaDevengamiento') ?? ''),
      contraparteId,
      descripcion: String(formData.get('descripcion') ?? '').trim() || null,
      moneda: (String(formData.get('moneda') ?? 'ARS')) as Moneda,
      tipoComprobante: String(formData.get('tipoComprobante') ?? '') || null,
      puntoVenta: String(formData.get('puntoVenta') ?? '').trim() || null,
      numero: String(formData.get('numero') ?? '').trim() || null,
      cae: String(formData.get('cae') ?? '').trim() || null,
      cuitEmisor: normalizarCuit(String(formData.get('cuitEmisor') ?? '')) || null,
      importes: {
        netoGravado: aNumero(formData.get('netoGravado')),
        iva21: aNumero(formData.get('iva21')),
        iva105: aNumero(formData.get('iva105')),
        iva27: aNumero(formData.get('iva27')),
        percepcionesIva: aNumero(formData.get('percepcionesIva')),
        percepcionesIibb: aNumero(formData.get('percepcionesIibb')),
        otrosTributos: aNumero(formData.get('otrosTributos')),
        noGravadoExento: aNumero(formData.get('noGravadoExento')),
        total: aNumero(formData.get('total')),
      },
      confirmarArcaInvalido: formData.get('confirmarArcaInvalido') === 'on',
      overrideNoFiscal: formData.get('overrideNoFiscal') === 'on',
      overrideNoFiscalMotivo: String(formData.get('overrideNoFiscalMotivo') ?? '').trim() || null,
      instruccionesExtraccion: String(formData.get('instruccionesExtraccion') ?? '').trim() || undefined,
      // Imputación opcional en la misma pantalla (validar + asignar juntos).
      categoriaId: String(formData.get('categoriaId') ?? '') || null,
      lineas: leerLineas(formData),
    });

    if (irAlSiguiente) {
      const siguiente = await ctx.db.movimiento.findFirst({
        where: { estado: 'PENDIENTE_VALIDACION', id: { not: movimientoId } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      siguienteId = siguiente?.id ?? null;
    }
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  revalidatePath(`/${slug}/validacion`);
  redirect(siguienteId ? `/${slug}/validacion/${siguienteId}` : `/${slug}/validacion?ok=Movimiento+validado`);
}

export async function observarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await observarMovimiento(ctx, movimientoId, String(formData.get('nota') ?? '').trim() || undefined);
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`/${slug}/validacion?ok=Movimiento+observado`);
}

export async function volverAPendienteAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await volverAPendiente(ctx, movimientoId);
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`/${slug}/validacion/${movimientoId}`);
}

export async function anularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  const volverA = String(formData.get('volverA') ?? '') || `/${slug}/validacion`;
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await anularMovimiento(ctx, movimientoId, String(formData.get('motivo') ?? ''));
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`${volverA}${volverA.includes('?') ? '&' : '?'}ok=Movimiento+anulado`);
}

export async function reintentarAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await reintentarExtraccion(ctx, movimientoId);
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`/${slug}/validacion?ok=Reintento+encolado`);
}

export async function cargarAManoAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await cargarAManoDesdeError(ctx, movimientoId);
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`/${slug}/validacion/${movimientoId}`);
}

/** Re-runs the ARCA verification on demand (badge refresh is immediate). */
export async function reArcaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const movimientoId = String(formData.get('movimientoId'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    await procesarArca({ movimientoId, empresaId: ctx.empresa.id });
  } catch (err) {
    volverConError(slug, movimientoId, err);
  }
  redirect(`/${slug}/validacion/${movimientoId}`);
}
