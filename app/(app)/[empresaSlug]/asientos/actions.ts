'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden, DomainError } from '@/lib/errors';
import { crearAsientoManual, crearVentaManual, generarRecurrentes } from '@/lib/movimientos/service';
import { getFileStorage } from '@/lib/storage';
import { writeAudit } from '@/lib/audit';

function aNumero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function leerLineas(formData: FormData) {
  const ccIds = formData.getAll('linea_centroCostoId').map(String);
  const cpIds = formData.getAll('linea_clienteProyectoId').map(String);
  const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
  return ccIds
    .map((cc, i) => ({ centroCostoId: cc, clienteProyectoId: cpIds[i] || null, porcentaje: pcts[i] }))
    .filter((l) => l.centroCostoId);
}

function volver(slug: string, err?: unknown, ok?: string): never {
  revalidatePath(`/${slug}/asientos`);
  if (err) {
    if (isDomainError(err) || isForbidden(err)) {
      redirect(`/${slug}/asientos?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/${slug}/asientos${ok ? `?ok=${encodeURIComponent(ok)}` : ''}`);
}

async function guardarAdjunto(formData: FormData, empresaId: string) {
  const archivo = formData.get('adjunto');
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > 15 * 1024 * 1024) throw new DomainError('El adjunto supera 15 MB.');
  const buffer = Buffer.from(await archivo.arrayBuffer());
  const { key, hash } = await getFileStorage().put(buffer, {
    filename: archivo.name,
    mime: archivo.type || 'application/octet-stream',
    empresaId,
  });
  return { key, nombre: archivo.name, mime: archivo.type || 'application/octet-stream', hash };
}

// Loaders (CARGADOR) can create drafts; "validar al guardar" only takes effect
// for VALIDADOR+ (enforced again inside the service layer).
export async function crearAsientoAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'CARGADOR');
    const archivo = await guardarAdjunto(formData, ctx.empresa.id);
    await crearAsientoManual(ctx, {
      fechaDevengamiento: String(formData.get('fechaDevengamiento') ?? ''),
      categoriaId: String(formData.get('categoriaId') ?? ''),
      total: aNumero(formData.get('total')) ?? NaN,
      descripcion: String(formData.get('descripcion') ?? '').trim() || null,
      contraparteId: String(formData.get('contraparteId') ?? '') || null,
      lineas: leerLineas(formData),
      validarAlGuardar: formData.get('validarAlGuardar') === 'on',
      archivo,
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Asiento creado');
}

export async function crearVentaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'CARGADOR');
    const archivo = await guardarAdjunto(formData, ctx.empresa.id);
    const total = aNumero(formData.get('total'));
    await crearVentaManual(ctx, {
      fechaDevengamiento: String(formData.get('fechaDevengamiento') ?? ''),
      categoriaId: String(formData.get('categoriaId') ?? ''),
      total: total ?? NaN,
      descripcion: String(formData.get('descripcion') ?? '').trim() || null,
      contraparteId: String(formData.get('contraparteId') ?? '') || null,
      tipoComprobante: String(formData.get('tipoComprobante') ?? '') || null,
      puntoVenta: String(formData.get('puntoVenta') ?? '').trim() || null,
      numero: String(formData.get('numero') ?? '').trim() || null,
      importes: {
        netoGravado: aNumero(formData.get('netoGravado')),
        iva21: aNumero(formData.get('iva21')),
        iva105: aNumero(formData.get('iva105')),
        iva27: aNumero(formData.get('iva27')),
        percepcionesIva: null,
        percepcionesIibb: aNumero(formData.get('percepcionesIibb')),
        otrosTributos: aNumero(formData.get('otrosTributos')),
        noGravadoExento: aNumero(formData.get('noGravadoExento')),
        total,
      },
      lineas: leerLineas(formData),
      validarAlGuardar: formData.get('validarAlGuardar') === 'on',
      archivo,
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Venta registrada');
}

// ---------- Recurring templates ----------

export async function guardarPlantillaRecurrente(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const categoriaId = String(formData.get('categoriaId') ?? '');
    const importeSugerido = aNumero(formData.get('importeSugerido'));
    const diaDelMes = Number(formData.get('diaDelMes') ?? 1);
    const distribucionId = String(formData.get('distribucionId') ?? '') || null;
    const usarImporteMesAnterior = formData.get('usarImporteMesAnterior') === 'on';
    const descripcion = String(formData.get('descripcion') ?? '').trim() || null;

    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    if (importeSugerido == null) throw new DomainError('El importe sugerido es obligatorio.');
    if (!(diaDelMes >= 1 && diaDelMes <= 28)) throw new DomainError('El día del mes debe estar entre 1 y 28.');
    if (!(await ctx.db.categoria.findFirst({ where: { id: categoriaId, activa: true } }))) {
      throw new DomainError('Elegí una categoría válida.');
    }
    if (distribucionId && !(await ctx.db.plantillaDistribucion.findFirst({ where: { id: distribucionId } }))) {
      throw new DomainError('Plantilla de distribución inexistente.');
    }

    const data = { nombre, categoriaId, importeSugerido, diaDelMes, distribucionId, usarImporteMesAnterior, descripcion };
    if (id) {
      const antes = await ctx.db.plantillaRecurrente.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Plantilla inexistente.');
      await ctx.db.plantillaRecurrente.update({ where: { id }, data });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'PlantillaRecurrente', entidadId: id, accion: 'EDITAR', antes, despues: data });
    } else {
      const nueva = await ctx.db.plantillaRecurrente.create({ data: data as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'PlantillaRecurrente', entidadId: nueva.id, accion: 'CREAR', despues: data });
    }
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Plantilla recurrente guardada');
}

export async function togglePlantillaRecurrente(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const p = await ctx.db.plantillaRecurrente.findFirst({ where: { id } });
    if (!p) throw new DomainError('Plantilla inexistente.');
    await ctx.db.plantillaRecurrente.update({ where: { id }, data: { activa: !p.activa } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'PlantillaRecurrente', entidadId: id, accion: p.activa ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug);
}

export async function generarRecurrentesAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  let resultado = { creados: 0, salteados: 0 };
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const [anio, mes] = String(formData.get('mes') ?? '').split('-').map(Number);
    if (!anio || !mes) throw new DomainError('Elegí el mes a generar.');
    resultado = await generarRecurrentes(ctx, anio, mes);
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'PlantillaRecurrente',
      entidadId: `${anio}-${mes}`,
      accion: 'GENERAR_MES',
      despues: { anio, mes, ...resultado },
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(
    slug,
    undefined,
    `Recurrentes generados: ${resultado.creados} creados, ${resultado.salteados} ya existían. Quedaron pendientes de validación.`,
  );
}
