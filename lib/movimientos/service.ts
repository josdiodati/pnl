import { prisma } from '@/lib/db';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { assertTransicion, esEstadoInicialValido } from './estados';
import { validarDistribucion, type LineaDistribucion } from './distribucion';
import { getOrCreatePeriodo, periodoDeFecha, nombrePeriodo } from '@/lib/periodos';
import { checkAritmetica } from '@/lib/checks';
import { rolAlcanza } from '@/lib/roles';
import { enqueueJob } from '@/lib/jobs';
import type { Movimiento, Moneda } from '@prisma/client';

// Service layer: every relevant mutation passes through here so state
// transitions, period locks, 100% splits and audit trail are enforced in ONE
// place — never in page components.

export type ImportesInput = {
  netoGravado?: number | null;
  iva21?: number | null;
  iva105?: number | null;
  iva27?: number | null;
  percepcionesIva?: number | null;
  percepcionesIibb?: number | null;
  otrosTributos?: number | null;
  noGravadoExento?: number | null;
  total?: number | null;
};

function snapshot(mov: Movimiento): Record<string, unknown> {
  const { extraccionRaw, confianza, camposRevisar, ...rest } = mov as never as Record<string, unknown>;
  return rest;
}

async function assertPeriodoAbierto(ctx: EmpresaContext, fecha: Date, accion: string): Promise<string> {
  const periodo = await getOrCreatePeriodo(ctx.db, fecha);
  if (periodo.estado === 'CERRADO') {
    const { anio, mes } = periodoDeFecha(fecha);
    throw new DomainError(
      `No se puede ${accion}: el período ${nombrePeriodo(anio, mes)} está cerrado. Un administrador debe reabrirlo.`,
    );
  }
  return periodo.id;
}

async function reemplazarLineas(ctx: EmpresaContext, movimientoId: string, lineas: LineaDistribucion[]): Promise<void> {
  validarDistribucion(lineas);
  // Cost centers (and optional client/project) must belong to the company.
  for (const linea of lineas) {
    const cc = await ctx.db.centroCosto.findFirst({ where: { id: linea.centroCostoId } });
    if (!cc) throw new DomainError('Centro de costo inexistente en esta empresa.');
    if (linea.clienteProyectoId) {
      const cp = await ctx.db.clienteProyecto.findFirst({ where: { id: linea.clienteProyectoId } });
      if (!cp) throw new DomainError('Cliente/proyecto inexistente en esta empresa.');
    }
  }
  await prisma.movimientoLinea.deleteMany({ where: { movimientoId } });
  await prisma.movimientoLinea.createMany({
    data: lineas.map((l) => ({
      movimientoId,
      centroCostoId: l.centroCostoId,
      clienteProyectoId: l.clienteProyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
}

async function getMovimientoOrThrow(ctx: EmpresaContext, id: string): Promise<Movimiento> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  return mov;
}

// ---------- Validation ----------

export type DatosValidacion = {
  fechaDevengamiento: string; // YYYY-MM-DD
  categoriaId: string;
  contraparteId?: string | null;
  descripcion?: string | null;
  moneda?: Moneda;
  tipoComprobante?: string | null;
  puntoVenta?: string | null;
  numero?: string | null;
  cae?: string | null;
  cuitEmisor?: string | null;
  importes?: ImportesInput;
  lineas: LineaDistribucion[];
  /** Explicit extra confirmation required when ARCA says INVALIDO (audited). */
  confirmarArcaInvalido?: boolean;
  /** Recurring correction note saved on the contraparte for future extractions. */
  instruccionesExtraccion?: string | null;
};

export async function validarMovimiento(ctx: EmpresaContext, id: string, datos: DatosValidacion): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  assertTransicion(mov.estado, 'VALIDADO');

  if (!datos.fechaDevengamiento) throw new DomainError('La fecha de devengamiento es obligatoria.');
  const fecha = new Date(`${datos.fechaDevengamiento}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) throw new DomainError('Fecha de devengamiento inválida.');
  const periodoId = await assertPeriodoAbierto(ctx, fecha, 'validar');

  const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');

  if (datos.contraparteId) {
    const contraparte = await ctx.db.contraparte.findFirst({ where: { id: datos.contraparteId } });
    if (!contraparte) throw new DomainError('Contraparte inexistente en esta empresa.');
  }

  const total = datos.importes?.total ?? (mov.total != null ? Number(mov.total) : null);
  if (total == null) throw new DomainError('El total es obligatorio para validar.');

  if (mov.arcaEstado === 'INVALIDO' && !datos.confirmarArcaInvalido) {
    throw new DomainError(
      'Este comprobante figura como INVÁLIDO en ARCA. Para validarlo igual tenés que marcar la confirmación explícita.',
    );
  }

  const antes = snapshot(mov);
  await reemplazarLineas(ctx, mov.id, datos.lineas);
  const actualizado = await ctx.db.movimiento.update({
    where: { id: mov.id },
    data: {
      estado: 'VALIDADO',
      validadoPorId: ctx.usuario.id,
      fechaDevengamiento: fecha,
      periodoId,
      categoriaId: datos.categoriaId,
      contraparteId: datos.contraparteId ?? null,
      descripcion: datos.descripcion ?? mov.descripcion,
      moneda: datos.moneda ?? mov.moneda,
      tipoComprobante: datos.tipoComprobante !== undefined ? datos.tipoComprobante : mov.tipoComprobante,
      puntoVenta: datos.puntoVenta !== undefined ? datos.puntoVenta : mov.puntoVenta,
      numero: datos.numero !== undefined ? datos.numero : mov.numero,
      cae: datos.cae !== undefined ? datos.cae : mov.cae,
      cuitEmisor: datos.cuitEmisor !== undefined ? datos.cuitEmisor : mov.cuitEmisor,
      ...(datos.importes
        ? {
            netoGravado: datos.importes.netoGravado,
            iva21: datos.importes.iva21,
            iva105: datos.importes.iva105,
            iva27: datos.importes.iva27,
            percepcionesIva: datos.importes.percepcionesIva,
            percepcionesIibb: datos.importes.percepcionesIibb,
            otrosTributos: datos.importes.otrosTributos,
            noGravadoExento: datos.importes.noGravadoExento,
            total: datos.importes.total,
          }
        : {}),
    },
  });

  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'VALIDAR',
    antes,
    despues: {
      ...snapshot(actualizado),
      lineas: datos.lineas,
      ...(mov.arcaEstado === 'INVALIDO' ? { arcaInvalidoConfirmadoPorValidador: true } : {}),
    },
  });

  // Persist the recurring-correction note on the supplier (auditable learning)
  if (datos.instruccionesExtraccion !== undefined && datos.instruccionesExtraccion !== null && datos.contraparteId) {
    const contraparte = await ctx.db.contraparte.findFirst({ where: { id: datos.contraparteId } });
    if (contraparte && (contraparte.instruccionesExtraccion ?? '') !== datos.instruccionesExtraccion) {
      await ctx.db.contraparte.update({
        where: { id: contraparte.id },
        data: { instruccionesExtraccion: datos.instruccionesExtraccion || null },
      });
      await writeAudit(ctx.db, {
        usuarioId: ctx.usuario.id,
        entidad: 'Contraparte',
        entidadId: contraparte.id,
        accion: 'EDITAR_INSTRUCCIONES',
        antes: { instruccionesExtraccion: contraparte.instruccionesExtraccion },
        despues: { instruccionesExtraccion: datos.instruccionesExtraccion },
      });
    }
  }
}

// ---------- Observe / back to pending / void ----------

export async function observarMovimiento(ctx: EmpresaContext, id: string, nota?: string): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  assertTransicion(mov.estado, 'OBSERVADO');
  await ctx.db.movimiento.update({
    where: { id },
    data: {
      estado: 'OBSERVADO',
      flags: { ...(mov.flags as object | null ?? {}), notaObservacion: nota ?? null } as never,
    },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'OBSERVAR',
    antes: { estado: mov.estado },
    despues: { estado: 'OBSERVADO', nota: nota ?? null },
  });
}

export async function volverAPendiente(ctx: EmpresaContext, id: string): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  assertTransicion(mov.estado, 'PENDIENTE_VALIDACION');
  await ctx.db.movimiento.update({ where: { id }, data: { estado: 'PENDIENTE_VALIDACION' } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'VOLVER_A_PENDIENTE',
    antes: { estado: mov.estado },
    despues: { estado: 'PENDIENTE_VALIDACION' },
  });
}

export async function anularMovimiento(ctx: EmpresaContext, id: string, motivo: string): Promise<void> {
  if (!motivo?.trim()) throw new DomainError('El motivo de anulación es obligatorio.');
  const mov = await getMovimientoOrThrow(ctx, id);
  assertTransicion(mov.estado, 'ANULADO');
  if (mov.fechaDevengamiento) {
    await assertPeriodoAbierto(ctx, mov.fechaDevengamiento, 'anular');
  }
  await ctx.db.movimiento.update({
    where: { id },
    data: { estado: 'ANULADO', motivoAnulacion: motivo.trim() },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'ANULAR',
    antes: { estado: mov.estado },
    despues: { estado: 'ANULADO', motivo: motivo.trim() },
  });
}

// ---------- Error recovery ----------

export async function reintentarExtraccion(ctx: EmpresaContext, id: string): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  assertTransicion(mov.estado, 'PROCESANDO');
  await ctx.db.movimiento.update({ where: { id }, data: { estado: 'PROCESANDO' } });
  await enqueueJob('EXTRACCION', { movimientoId: id, empresaId: ctx.empresa.id }, ctx.empresa.id);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'REINTENTAR_EXTRACCION',
    antes: { estado: mov.estado },
    despues: { estado: 'PROCESANDO' },
  });
}

/** "Cargar a mano": skip OCR after a final failure and edit fields manually. */
export async function cargarAManoDesdeError(ctx: EmpresaContext, id: string): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  if (mov.estado !== 'ERROR_PROCESAMIENTO') throw new DomainError('Solo aplica a movimientos con error de procesamiento.');
  assertTransicion(mov.estado, 'PENDIENTE_VALIDACION');
  await ctx.db.movimiento.update({ where: { id }, data: { estado: 'PENDIENTE_VALIDACION' } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'CARGAR_A_MANO',
    antes: { estado: mov.estado },
    despues: { estado: 'PENDIENTE_VALIDACION' },
  });
}

// ---------- Manual entries (asiento / venta) ----------

export type DatosAsientoManual = {
  fechaDevengamiento: string;
  categoriaId: string;
  total: number; // may be negative for adjustments
  descripcion?: string | null;
  contraparteId?: string | null;
  lineas: LineaDistribucion[];
  validarAlGuardar?: boolean;
  archivo?: { key: string; nombre: string; mime: string; hash: string } | null;
  flags?: Record<string, unknown>;
};

export async function crearAsientoManual(ctx: EmpresaContext, datos: DatosAsientoManual): Promise<string> {
  return crearMovimientoManual(ctx, 'ASIENTO_MANUAL', datos);
}

export type DatosVentaManual = DatosAsientoManual & {
  tipoComprobante?: string | null;
  puntoVenta?: string | null;
  numero?: string | null;
  importes?: ImportesInput;
};

export async function crearVentaManual(ctx: EmpresaContext, datos: DatosVentaManual): Promise<string> {
  const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');
  if (categoria.tipo !== 'INGRESO') throw new DomainError('Una venta manual debe usar una categoría de INGRESO.');
  if (datos.contraparteId) {
    const cliente = await ctx.db.contraparte.findFirst({ where: { id: datos.contraparteId } });
    if (!cliente) throw new DomainError('Cliente inexistente en esta empresa.');
    if (cliente.tipo === 'PROVEEDOR') throw new DomainError('La contraparte de una venta debe ser de tipo CLIENTE (o AMBOS).');
  }
  if (datos.importes) {
    const arit = checkAritmetica(datos.importes);
    if (!arit.ok) {
      throw new DomainError(
        `Los importes no cierran: la suma de componentes ($${arit.sumaComponentes.toFixed(2)}) difiere del total en $${arit.diferencia.toFixed(2)}.`,
      );
    }
  }
  return crearMovimientoManual(ctx, 'VENTA_MANUAL', datos);
}

async function crearMovimientoManual(
  ctx: EmpresaContext,
  origen: 'ASIENTO_MANUAL' | 'VENTA_MANUAL',
  datos: DatosVentaManual,
): Promise<string> {
  if (!datos.fechaDevengamiento) throw new DomainError('La fecha de devengamiento es obligatoria.');
  const fecha = new Date(`${datos.fechaDevengamiento}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) throw new DomainError('Fecha inválida.');
  if (datos.total == null || Number.isNaN(datos.total)) throw new DomainError('El importe es obligatorio.');

  const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');

  const periodoId = await assertPeriodoAbierto(ctx, fecha, 'crear el movimiento');
  validarDistribucion(datos.lineas);

  // Only validators+ may validate at save time; loaders always create pending.
  const validaDirecto = Boolean(datos.validarAlGuardar) && rolAlcanza(ctx.rol, 'VALIDADOR');
  const estado = validaDirecto ? 'VALIDADO' : 'PENDIENTE_VALIDACION';
  if (!esEstadoInicialValido(origen, estado)) throw new DomainError('Estado inicial inválido.');

  const mov = await ctx.db.movimiento.create({
    data: {
      origen,
      estado,
      canalIngreso: 'MANUAL',
      fechaDevengamiento: fecha,
      periodoId,
      categoriaId: datos.categoriaId,
      contraparteId: datos.contraparteId ?? null,
      descripcion: datos.descripcion ?? null,
      total: datos.total,
      ...(datos.importes
        ? {
            netoGravado: datos.importes.netoGravado,
            iva21: datos.importes.iva21,
            iva105: datos.importes.iva105,
            iva27: datos.importes.iva27,
            percepcionesIva: datos.importes.percepcionesIva,
            percepcionesIibb: datos.importes.percepcionesIibb,
            otrosTributos: datos.importes.otrosTributos,
            noGravadoExento: datos.importes.noGravadoExento,
            total: datos.importes.total ?? datos.total,
          }
        : {}),
      tipoComprobante: datos.tipoComprobante ?? null,
      puntoVenta: datos.puntoVenta ?? null,
      numero: datos.numero ?? null,
      ...(datos.archivo
        ? {
            archivoKey: datos.archivo.key,
            archivoNombre: datos.archivo.nombre,
            archivoMime: datos.archivo.mime,
            archivoHash: datos.archivo.hash,
          }
        : {}),
      flags: (datos.flags ?? undefined) as never,
      creadoPorId: ctx.usuario.id,
      validadoPorId: validaDirecto ? ctx.usuario.id : null,
    } as never,
  });

  await reemplazarLineas(ctx, mov.id, datos.lineas);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: validaDirecto ? 'CREAR_Y_VALIDAR' : 'CREAR',
    despues: { origen, estado, total: datos.total, categoriaId: datos.categoriaId, lineas: datos.lineas },
  });
  return mov.id;
}

// ---------- Recurring templates ----------

/**
 * "Generar recurrentes del mes": creates one pending entry per active template
 * for (anio, mes), idempotently (a template already generated for that month
 * is skipped). Salary-style templates copy the previous month's amount.
 */
export async function generarRecurrentes(ctx: EmpresaContext, anio: number, mes: number): Promise<{ creados: number; salteados: number }> {
  const primerDia = new Date(Date.UTC(anio, mes - 1, 1));
  await assertPeriodoAbierto(ctx, primerDia, 'generar recurrentes');

  const plantillas = await ctx.db.plantillaRecurrente.findMany({ where: { activa: true } });
  const desde = new Date(Date.UTC(anio, mes - 1, 1));
  const hasta = new Date(Date.UTC(anio, mes, 1));

  let creados = 0;
  let salteados = 0;
  for (const p of plantillas) {
    const yaGenerado = await ctx.db.movimiento.findFirst({
      where: {
        origen: 'ASIENTO_MANUAL',
        estado: { not: 'ANULADO' },
        fechaDevengamiento: { gte: desde, lt: hasta },
        flags: { path: ['plantillaRecurrenteId'], equals: p.id },
      },
    });
    if (yaGenerado) {
      salteados++;
      continue;
    }

    let importe = Number(p.importeSugerido);
    if (p.usarImporteMesAnterior) {
      const mesAnteriorDesde = new Date(Date.UTC(anio, mes - 2, 1));
      const anterior = await ctx.db.movimiento.findFirst({
        where: {
          origen: 'ASIENTO_MANUAL',
          estado: 'VALIDADO',
          fechaDevengamiento: { gte: mesAnteriorDesde, lt: desde },
          flags: { path: ['plantillaRecurrenteId'], equals: p.id },
        },
        orderBy: { fechaDevengamiento: 'desc' },
      });
      if (anterior?.total != null) importe = Number(anterior.total);
    }

    let lineas: LineaDistribucion[] = [];
    if (p.distribucionId) {
      const plantillaDist = await ctx.db.plantillaDistribucion.findFirst({
        where: { id: p.distribucionId },
        include: { lineas: true },
      });
      if (plantillaDist) {
        lineas = plantillaDist.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteProyectoId: l.clienteProyectoId,
          porcentaje: Number(l.porcentaje),
        }));
      }
    }
    if (!lineas.length) {
      // No distribution template: default to the first active cost center, 100%.
      const cc = await ctx.db.centroCosto.findFirst({ where: { activo: true }, orderBy: { nombre: 'asc' } });
      if (!cc) throw new DomainError('No hay centros de costo activos para generar recurrentes.');
      lineas = [{ centroCostoId: cc.id, porcentaje: 100 }];
    }

    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const dia = Math.min(p.diaDelMes, ultimoDia);
    const fechaStr = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

    await crearMovimientoManual(ctx, 'ASIENTO_MANUAL', {
      fechaDevengamiento: fechaStr,
      categoriaId: p.categoriaId,
      total: importe,
      descripcion: `${p.nombre} (recurrente ${nombrePeriodo(anio, mes)})`,
      lineas,
      validarAlGuardar: false,
      flags: { plantillaRecurrenteId: p.id },
    });
    creados++;
  }
  return { creados, salteados };
}

// ---------- Periods ----------

export async function cerrarPeriodo(ctx: EmpresaContext, anio: number, mes: number): Promise<void> {
  const desde = new Date(Date.UTC(anio, mes - 1, 1));
  const hasta = new Date(Date.UTC(anio, mes, 1));
  const sinResolver = await ctx.db.movimiento.count({
    where: {
      fechaDevengamiento: { gte: desde, lt: hasta },
      estado: { in: ['PENDIENTE_VALIDACION', 'OBSERVADO'] },
    },
  });
  if (sinResolver > 0) {
    throw new DomainError(
      `No se puede cerrar ${nombrePeriodo(anio, mes)}: hay ${sinResolver} movimiento(s) pendiente(s) u observado(s) en ese mes. Validalos o anulalos primero.`,
    );
  }
  const periodo = await getOrCreatePeriodo(ctx.db, desde);
  if (periodo.estado === 'CERRADO') throw new DomainError('El período ya está cerrado.');
  await ctx.db.periodo.update({
    where: { id: periodo.id },
    data: { estado: 'CERRADO', cerradoPorId: ctx.usuario.id, cerradoAt: new Date() },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Periodo',
    entidadId: periodo.id,
    accion: 'CERRAR',
    despues: { anio, mes },
  });
}

/** Reopening is ADMIN-only (enforced by the caller's requireEmpresa) and audited with a reason. */
export async function reabrirPeriodo(ctx: EmpresaContext, anio: number, mes: number, motivo: string): Promise<void> {
  if (!motivo?.trim()) throw new DomainError('El motivo de reapertura es obligatorio.');
  const periodo = await ctx.db.periodo.findFirst({ where: { anio, mes } });
  if (!periodo || periodo.estado !== 'CERRADO') throw new DomainError('El período no está cerrado.');
  await ctx.db.periodo.update({
    where: { id: periodo.id },
    data: { estado: 'ABIERTO', cerradoPorId: null, cerradoAt: null },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Periodo',
    entidadId: periodo.id,
    accion: 'REABRIR',
    antes: { estado: 'CERRADO' },
    despues: { anio, mes, motivo: motivo.trim() },
  });
}
