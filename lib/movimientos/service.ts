import { prisma } from '@/lib/db';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import type { ScopedDb } from '@/lib/empresa/scope';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { assertTransicion, esEstadoInicialValido, ESTADOS_BLOQUEAN_CIERRE } from './estados';
import { validarDistribucion, type LineaDistribucion } from './distribucion';
import { getOrCreatePeriodo, periodoDeFecha, nombrePeriodo } from '@/lib/periodos';
import { checkAritmetica } from '@/lib/checks';
import { rolAlcanza } from '@/lib/roles';
import { enqueueJob } from '@/lib/jobs';
import type { Movimiento, Moneda } from '@prisma/client';

/** Asignar requiere estar fiscalmente validado (o re-asignar). */
export function puedeAsignar(estado: string): boolean {
  return estado === 'VALIDADO' || estado === 'ASIGNADO';
}

/** ¿El movimiento ya tiene imputación completa (categoría + líneas que suman 100)? */
export function tieneAsignacionCompleta(categoriaId: string | null | undefined, lineas: LineaDistribucion[]): boolean {
  if (!categoriaId || !lineas.length) return false;
  const suma = lineas.reduce((a, l) => a + Math.round(l.porcentaje * 10000), 0);
  return suma === 1000000 && lineas.every((l) => l.centroCostoId);
}

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

/** Un comprobante es constatable si tiene CAE: el CAE ES el código de
 *  autorización de ARCA, así que su presencia es lo que habilita preguntar. */
export function esConstatable(cae: string | null | undefined): boolean {
  return Boolean(cae && cae.trim());
}

/** Gate de ARCA: un comprobante solo se valida si ARCA dice VALIDO, salvo override.
 *
 *  Excepción: un comprobante CON CAE que todavía no se constató está *pendiente*,
 *  no es *no constatable*. Puede haber destiempo (el job no corrió, el webservice
 *  demoró, o el validador acaba de cargar el CAE a mano), y exigirle un override
 *  al validador por una demora del sistema no tiene sentido. Se valida y la
 *  constatación sigue por atrás; si vuelve INVALIDO, procesarArca lo aparta. */
export function puedeValidarArca(
  arcaEstado: string,
  opts: { cae?: string | null; confirmarArcaInvalido?: boolean; overrideNoFiscal?: boolean; overrideNoFiscalMotivo?: string | null },
): { ok: boolean; motivo?: string } {
  if (arcaEstado === 'VALIDO') return { ok: true };
  if (arcaEstado === 'INVALIDO') {
    return opts.confirmarArcaInvalido
      ? { ok: true }
      : { ok: false, motivo: 'Este comprobante figura como INVÁLIDO en ARCA. Para validarlo igual tenés que marcar la confirmación explícita.' };
  }
  // NO_VERIFICADO | ERROR_CONSULTA
  if (esConstatable(opts.cae)) return { ok: true }; // pendiente de constatación
  if (opts.overrideNoFiscal) {
    return opts.overrideNoFiscalMotivo && opts.overrideNoFiscalMotivo.trim()
      ? { ok: true }
      : { ok: false, motivo: 'El override de un comprobante no constatable por ARCA requiere un motivo.' };
  }
  return { ok: false, motivo: 'Este comprobante no tiene CAE, así que ARCA no puede constatarlo. Marcá el override (no fiscal / extranjero) con un motivo para validarlo igual.' };
}

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

/**
 * Valida que el centro de costo (y el cliente/proyecto opcionales) de cada
 * línea pertenezcan a esta empresa: se consulta con el cliente scoped, así
 * que un ID de otra empresa colado desde el form nunca matchea. Se usa antes
 * de persistir cualquier distribución (movimientos y, ahora, recibos de
 * sueldo / fichas de empleado).
 */
export async function validarPertenenciaLineas(db: ScopedDb, lineas: LineaDistribucion[]): Promise<void> {
  for (const linea of lineas) {
    const cc = await db.centroCosto.findFirst({ where: { id: linea.centroCostoId } });
    if (!cc) throw new DomainError('Centro de costo inexistente en esta empresa.');
    if (linea.clienteId) {
      const cli = await db.cliente.findFirst({ where: { id: linea.clienteId } });
      if (!cli) throw new DomainError('Cliente inexistente en esta empresa.');
      // Árbol de asignación: un cliente clasificado sólo vale bajo su centro.
      if (cli.centroCostoId && cli.centroCostoId !== linea.centroCostoId) {
        throw new DomainError(`El cliente «${cli.nombre}» pertenece a otro centro de costo.`);
      }
    }
    if (linea.proyectoId) {
      const pr = await db.proyecto.findFirst({ where: { id: linea.proyectoId } });
      if (!pr) throw new DomainError('Proyecto inexistente en esta empresa.');
      // Ídem: un proyecto clasificado sólo vale bajo su cliente.
      if (pr.clienteId && pr.clienteId !== (linea.clienteId ?? null)) {
        throw new DomainError(`El proyecto «${pr.nombre}» pertenece a otro cliente.`);
      }
    }
  }
}

async function reemplazarLineas(ctx: EmpresaContext, movimientoId: string, lineas: LineaDistribucion[]): Promise<void> {
  validarDistribucion(lineas);
  // Cost centers (and optional client/project) must belong to the company.
  await validarPertenenciaLineas(ctx.db, lineas);
  await prisma.movimientoLinea.deleteMany({ where: { movimientoId } });
  await prisma.movimientoLinea.createMany({
    data: lineas.map((l) => ({
      movimientoId,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
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
  contraparteId?: string | null;
  descripcion?: string | null;
  moneda?: Moneda;
  /** Pesos por unidad de moneda extranjera; obligatorio si moneda ≠ ARS. */
  tipoCambio?: number | null;
  tipoComprobante?: string | null;
  puntoVenta?: string | null;
  numero?: string | null;
  cae?: string | null;
  cuitEmisor?: string | null;
  importes?: ImportesInput;
  /** Explicit extra confirmation required when ARCA says INVALIDO (audited). */
  confirmarArcaInvalido?: boolean;
  /** Override para comprobantes no constatables por ARCA (no fiscales / extranjeros). Requiere motivo. */
  overrideNoFiscal?: boolean;
  overrideNoFiscalMotivo?: string | null;
  /** Recurring correction note saved on the contraparte for future extractions. */
  instruccionesExtraccion?: string | null;
  /** Imputación opcional hecha en la misma pantalla de validación (flujo manual:
   *  validar + asignar juntos). Si la imputación queda completa → ASIGNADO. */
  categoriaId?: string | null;
  lineas?: LineaDistribucion[];
};

export type DatosAsignacion = { categoriaId: string; lineas: LineaDistribucion[] };

export async function validarMovimiento(ctx: EmpresaContext, id: string, datos: DatosValidacion): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);

  if (!datos.fechaDevengamiento) throw new DomainError('La fecha de devengamiento es obligatoria.');
  const fecha = new Date(`${datos.fechaDevengamiento}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) throw new DomainError('Fecha de devengamiento inválida.');
  const periodoId = await assertPeriodoAbierto(ctx, fecha, 'validar');

  if (datos.contraparteId) {
    const contraparte = await ctx.db.contraparte.findFirst({ where: { id: datos.contraparteId } });
    if (!contraparte) throw new DomainError('Contraparte inexistente en esta empresa.');
  }

  const total = datos.importes?.total ?? (mov.total != null ? Number(mov.total) : null);
  if (total == null) throw new DomainError('El total es obligatorio para validar.');

  // Moneda extranjera: el libro unifica en pesos, así que el TC es obligatorio.
  const monedaEff = datos.moneda ?? mov.moneda;
  const tipoCambioEff = datos.tipoCambio !== undefined ? datos.tipoCambio : (mov.tipoCambio != null ? Number(mov.tipoCambio) : null);
  if (monedaEff !== 'ARS' && !(tipoCambioEff && tipoCambioEff > 0)) {
    throw new DomainError('El comprobante está en moneda extranjera: cargá el tipo de cambio para validarlo.');
  }

  // Gate de ARCA: solo aplica a comprobantes (no a asientos/ventas manuales sin archivo).
  if (mov.origen === 'COMPROBANTE' || mov.origen === 'VENTA_COMPROBANTE') {
    const gate = puedeValidarArca(mov.arcaEstado, {
      // El CAE que se está enviando, no el guardado: el validador puede estar
      // cargándolo ahora mismo porque el OCR no lo leyó.
      cae: datos.cae !== undefined ? datos.cae : mov.cae,
      confirmarArcaInvalido: datos.confirmarArcaInvalido,
      overrideNoFiscal: datos.overrideNoFiscal,
      overrideNoFiscalMotivo: datos.overrideNoFiscalMotivo,
    });
    if (!gate.ok) throw new DomainError(gate.motivo ?? 'No se puede validar por estado de ARCA.');
  }

  // Imputación opcional desde la misma pantalla (validar + asignar juntos).
  if (datos.categoriaId) {
    const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
    if (!categoria) throw new DomainError('Elegí una categoría válida.');
  }
  const categoriaEff = datos.categoriaId !== undefined ? (datos.categoriaId || null) : mov.categoriaId;

  // Estado destino: si la imputación queda completa, ASIGNADO; si no, VALIDADO.
  // Si el form mandó líneas, esas mandan; si no, se evalúan las ya existentes.
  const lineasActuales = await ctx.db.movimientoLinea.findMany({ where: { movimientoId: mov.id } });
  const lineasParaEstado: LineaDistribucion[] =
    datos.lineas !== undefined
      ? datos.lineas
      : lineasActuales.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId,
          proyectoId: l.proyectoId,
          porcentaje: Number(l.porcentaje),
        }));
  const yaAsignado = tieneAsignacionCompleta(categoriaEff, lineasParaEstado);
  const estadoDestino = yaAsignado ? 'ASIGNADO' : 'VALIDADO';
  assertTransicion(mov.estado, estadoDestino);

  const antes = snapshot(mov);
  const actualizado = await ctx.db.movimiento.update({
    where: { id: mov.id },
    data: {
      estado: estadoDestino,
      validadoPorId: ctx.usuario.id,
      fechaDevengamiento: fecha,
      periodoId,
      contraparteId: datos.contraparteId ?? null,
      categoriaId: categoriaEff,
      descripcion: datos.descripcion ?? mov.descripcion,
      moneda: monedaEff,
      tipoCambio: monedaEff === 'ARS' ? null : tipoCambioEff,
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

  // Si se imputó en la misma pantalla y quedó completa, persistir las líneas.
  if (yaAsignado && datos.lineas !== undefined) {
    await reemplazarLineas(ctx, mov.id, datos.lineas);
  }

  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'VALIDAR',
    antes,
    despues: {
      ...snapshot(actualizado),
      ...(mov.arcaEstado === 'INVALIDO' ? { arcaInvalidoConfirmadoPorValidador: true } : {}),
      ...(datos.overrideNoFiscal ? { overrideNoFiscal: true, overrideNoFiscalMotivo: datos.overrideNoFiscalMotivo ?? null } : {}),
    },
  });

  // Reencolar la constatación si quedó pendiente. El job de ARCA se encola una
  // sola vez, en la extracción, y sólo si el OCR sacó el CAE: sin esto, un CAE
  // cargado a mano no se constata NUNCA.
  if (
    (actualizado.origen === 'COMPROBANTE' || actualizado.origen === 'VENTA_COMPROBANTE') &&
    esConstatable(actualizado.cae) &&
    actualizado.arcaEstado !== 'VALIDO'
  ) {
    await enqueueJob('ARCA', { movimientoId: mov.id, empresaId: ctx.empresa.id }, ctx.empresa.id);
  }

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

// ---------- Assignment ----------

export async function asignarMovimiento(ctx: EmpresaContext, id: string, datos: DatosAsignacion): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  if (!puedeAsignar(mov.estado)) throw new DomainError('Solo se pueden asignar comprobantes validados.');
  const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');
  // El libro unifica en pesos: no entra al P&L una moneda extranjera sin TC
  // (cubre lo validado antes de que existiera el campo).
  if (mov.moneda !== 'ARS' && !(mov.tipoCambio != null && Number(mov.tipoCambio) > 0)) {
    throw new DomainError('El comprobante está en moneda extranjera sin tipo de cambio: cargalo desde Validación antes de asignar.');
  }
  if (mov.fechaDevengamiento) await assertPeriodoAbierto(ctx, mov.fechaDevengamiento, 'asignar');
  const antes = snapshot(mov);
  // Validate the transition BEFORE mutating the DB: if the state is illegal
  // we must not leave orphaned distribution lines behind.
  // Allow re-assign from ASIGNADO without assertTransicion (reflexive transition not in state machine).
  if (mov.estado !== 'ASIGNADO') assertTransicion(mov.estado, 'ASIGNADO');
  await reemplazarLineas(ctx, mov.id, datos.lineas);
  const actualizado = await ctx.db.movimiento.update({
    where: { id: mov.id },
    data: { estado: 'ASIGNADO', categoriaId: datos.categoriaId, validadoPorId: ctx.usuario.id },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'ASIGNAR',
    antes,
    despues: { ...snapshot(actualizado), lineas: datos.lineas },
  });
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

export async function volverAPendiente(ctx: EmpresaContext, id: string, nota?: string): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);

  // Un duplicado POR ARCHIVO nunca pasó por la extracción (se apartó en la
  // ingesta): recuperarlo lo devuelve al pipeline y re-encola su extracción,
  // en vez de dejar un pendiente vacío.
  if (mov.estado === 'DUPLICADO' && mov.extraccionRaw == null && mov.archivoKey) {
    assertTransicion(mov.estado, 'INGRESADO');
    await ctx.db.movimiento.update({ where: { id }, data: { estado: 'INGRESADO' } });
    await enqueueJob('EXTRACCION', { movimientoId: id, empresaId: ctx.empresa.id }, ctx.empresa.id);
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Movimiento',
      entidadId: id,
      accion: 'VOLVER_A_PENDIENTE',
      antes: { estado: mov.estado },
      despues: { estado: 'INGRESADO', nota: nota?.trim() || null, reprocesa: true },
    });
    return;
  }

  assertTransicion(mov.estado, 'PENDIENTE_VALIDACION');

  // Un pendiente bloquea el cierre del mes: devolver a revisión algo cuyo período
  // ya se cerró dejaría el cierre inconsistente.
  const yaValidado = mov.estado === 'VALIDADO' || mov.estado === 'ASIGNADO';
  if (yaValidado && mov.fechaDevengamiento) {
    await assertPeriodoAbierto(ctx, mov.fechaDevengamiento, 'devolver a revisión');
  }

  await ctx.db.movimiento.update({
    where: { id },
    // Deja de estar validado por alguien; la imputación se conserva por si sirve.
    data: { estado: 'PENDIENTE_VALIDACION', ...(yaValidado ? { validadoPorId: null } : {}) },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'VOLVER_A_PENDIENTE',
    antes: { estado: mov.estado, validadoPorId: mov.validadoPorId },
    despues: { estado: 'PENDIENTE_VALIDACION', nota: nota?.trim() || null },
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
  // Manuals carry full assignment (category + lines) so they are born ASIGNADO directly.
  const validaDirecto = Boolean(datos.validarAlGuardar) && rolAlcanza(ctx.rol, 'VALIDADOR');
  const estado = validaDirecto ? 'ASIGNADO' : 'PENDIENTE_VALIDACION';
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
          estado: { in: ['VALIDADO', 'ASIGNADO'] },
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
          clienteId: l.clienteId,
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
      estado: { in: ESTADOS_BLOQUEAN_CIERRE },
    },
  });
  if (sinResolver > 0) {
    throw new DomainError(
      `No se puede cerrar ${nombrePeriodo(anio, mes)}: hay ${sinResolver} movimiento(s) sin validar o sin asignar en ese mes. Resolvelos (validar + asignar) o anulalos primero.`,
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
