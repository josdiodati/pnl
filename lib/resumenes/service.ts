import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { validarDistribucion, type LineaDistribucion } from '@/lib/movimientos/distribucion';
import { validarPertenenciaLineas } from '@/lib/movimientos/service';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { assertTransicion } from '@/lib/movimientos/estados';
import { normalizarDescriptor } from './matching';
import { MOTIVOS_IGNORO_PNL } from './motivos';
import { rematchearResumen } from './ingesta';
import { confirmarCobroRegistrado, sincronizarCobrosDeLinea } from '@/lib/cobranzas/conciliacion';

// Acciones sobre líneas de resumen. Conciliar NO crea gasto (el movimiento ya
// está en el libro): acá muere el doble conteo. Imputar crea el gasto tomando
// la línea como base (origen RESUMEN, nace ASIGNADO). Todo auditado.
//
// El vínculo línea ↔ comprobante es N:M (tabla ResumenLineaVinculo): un
// comprobante pagado en varias líneas (pagos parciales, con confirmación
// explícita porque casi siempre es un error) y una línea que paga varios
// comprobantes (una transferencia por varias facturas).

async function lineaOrThrow(ctx: EmpresaContext, lineaId: string) {
  const linea = await ctx.db.resumenLinea.findFirst({
    where: { id: lineaId },
    include: { resumen: true, vinculos: { orderBy: { createdAt: 'asc' } } },
  });
  if (!linea) throw new DomainError('Línea de resumen inexistente.');
  return linea;
}

/**
 * Un resumen cuyo titular no coincide con la empresa (CUIT/razón social no
 * aparecen en el PDF) no se resuelve: se confirma a mano o se elimina.
 */
function assertTitularVerificado(resumen: { verificacionTitular: string; titularDetectado: string | null }): void {
  if (resumen.verificacionTitular !== 'NO_COINCIDE') return;
  throw new DomainError(
    `Este resumen parece ser de otra empresa${resumen.titularDetectado ? ` (${resumen.titularDetectado})` : ''}: confirmá que pertenece a esta empresa o eliminalo.`,
  );
}

async function aprenderDescriptor(ctx: EmpresaContext, contraparteId: string | null, descriptor: string): Promise<void> {
  if (!contraparteId) return;
  const contraparte = await ctx.db.contraparte.findFirst({ where: { id: contraparteId } });
  if (!contraparte) return;
  const lista = ((contraparte.descriptoresResumen as string[] | null) ?? []);
  const norm = normalizarDescriptor(descriptor);
  if (!norm || lista.includes(norm)) return;
  await ctx.db.contraparte.update({
    where: { id: contraparte.id },
    data: { descriptoresResumen: [...lista, norm].slice(-10) as never },
  });
}

export async function conciliarLinea(
  ctx: EmpresaContext,
  params: { lineaId: string; movimientoId: string; confirmarCompartido?: boolean },
): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  assertTitularVerificado(linea.resumen);
  // PENDIENTE/SUGERIDA: primer comprobante. CONCILIADA: se suma otro (la
  // línea paga varios comprobantes). IMPUTADA/IGNORADA: deshacer primero.
  if (linea.estado === 'IMPUTADA' || linea.estado === 'IGNORADA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  if (linea.vinculos.some((v) => v.movimientoId === params.movimientoId)) throw new DomainError('Ese comprobante ya está vinculado a esta línea.');
  const mov = await ctx.db.movimiento.findFirst({
    where: { id: params.movimientoId },
    include: { vinculosResumen: { include: { linea: { include: { resumen: true } } } } },
  });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.estado === 'ANULADO' || mov.estado === 'DUPLICADO') throw new DomainError('Ese movimiento está anulado o duplicado.');

  // Comprobante ya vinculado a OTRA línea: sólo con confirmación explícita
  // (un pago en cuotas / parcial). Uno nacido de una imputación no se comparte:
  // deshacer esa imputación lo anula y dejaría colgada a la otra línea.
  const ocupantes = mov.vinculosResumen.filter((v) => v.lineaId !== linea.id);
  const compartido = ocupantes.length > 0;
  if (compartido) {
    if (ocupantes.some((v) => v.linea.estado === 'IMPUTADA')) {
      throw new DomainError('Ese movimiento nació de la imputación de otra línea de resumen: no se puede compartir.');
    }
    if (!params.confirmarCompartido) {
      const o = ocupantes[0].linea;
      throw new DomainError(
        `Ese comprobante ya está vinculado a la línea «${o.descriptor}» del resumen ${o.resumen.emisor}. Si el comprobante se pagó en más de un movimiento, confirmá que corresponde.`,
      );
    }
  }

  await ctx.db.resumenLineaVinculo.create({ data: { lineaId: linea.id, movimientoId: mov.id } });
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'CONCILIADA', motivoIgnorada: null } });
  // Cobranzas: un crédito contra una venta confirma el cobro registrado (si lo
  // hay) o crea los cobros de la línea. Ver lib/cobranzas/conciliacion.
  await confirmarCobroRegistrado(ctx, linea, mov.id);
  await sincronizarCobrosDeLinea(ctx, linea.id);
  await aprenderDescriptor(ctx, mov.contraparteId, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_CONCILIAR',
    despues: {
      lineaId: linea.id,
      descriptor: linea.descriptor,
      movimientoId: mov.id,
      ...(compartido ? { compartido: true, otrasLineas: ocupantes.map((v) => v.lineaId) } : {}),
      ...(linea.vinculos.length > 0 ? { comprobantesPrevios: linea.vinculos.map((v) => v.movimientoId) } : {}),
    },
  });
}

/**
 * "Cobro de facturas…" (Spec F): concilia un crédito contra una o varias
 * ventas en un solo paso. Cada venta se vincula como en conciliarLinea (el
 * pago parcial compartido con otra línea es explícito: el usuario las eligió),
 * y los cobros de la línea se sincronizan: reparto FIFO, retención si falta
 * ≤ 5%, ajuste de cambio en moneda extranjera.
 */
export async function conciliarLineaConVentas(ctx: EmpresaContext, params: { lineaId: string; ventaIds: string[] }): Promise<void> {
  const ids = [...new Set(params.ventaIds.filter(Boolean))];
  if (ids.length === 0) throw new DomainError('Elegí al menos una factura.');
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.monto == null || Number(linea.monto) <= 0) throw new DomainError('Sólo un crédito (monto positivo) puede ser el cobro de facturas.');
  const ventas = await ctx.db.movimiento.findMany({ where: { id: { in: ids } }, select: { id: true, origen: true } });
  if (ventas.length !== ids.length || ventas.some((v) => v.origen !== 'VENTA_COMPROBANTE' && v.origen !== 'VENTA_MANUAL')) {
    throw new DomainError('Sólo se eligen facturas de venta de esta empresa.');
  }
  const yaVinculadas = new Set(linea.vinculos.map((v) => v.movimientoId));
  for (const id of ids) {
    if (yaVinculadas.has(id)) continue;
    await conciliarLinea(ctx, { lineaId: linea.id, movimientoId: id, confirmarCompartido: true });
  }
}

/**
 * Quita UN comprobante de una línea conciliada (la línea pagaba varios y uno
 * no correspondía). Sin comprobantes queda PENDIENTE. Una IMPUTADA se deshace
 * (anula el comprobante creado), no se desvincula.
 */
export async function desvincularLinea(ctx: EmpresaContext, params: { lineaId: string; movimientoId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado !== 'CONCILIADA') throw new DomainError('Sólo se desvinculan comprobantes de una línea conciliada.');
  const vinculo = linea.vinculos.find((v) => v.movimientoId === params.movimientoId);
  if (!vinculo) throw new DomainError('Ese comprobante no está vinculado a la línea.');
  await ctx.db.resumenLineaVinculo.delete({ where: { id: vinculo.id } });
  const restantes = linea.vinculos.length - 1;
  if (restantes === 0) {
    await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'PENDIENTE', reglaAplicada: null } });
  }
  await sincronizarCobrosDeLinea(ctx, linea.id);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_DESVINCULAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: params.movimientoId, restantes },
  });
}

export async function imputarLinea(
  ctx: EmpresaContext,
  params: { lineaId: string; categoriaId: string; lineas: LineaDistribucion[]; contraparteId?: string | null; montoArs?: number | null },
): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  assertTitularVerificado(linea.resumen);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');

  const montoBase = linea.monto != null ? Math.abs(Number(linea.monto)) : params.montoArs != null && params.montoArs > 0 ? params.montoArs : null;
  if (montoBase == null) throw new DomainError('La línea no tiene importe en pesos: ingresá el monto final en pesos para imputarla.');

  const categoria = await ctx.db.categoria.findFirst({ where: { id: params.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');
  validarDistribucion(params.lineas);
  await validarPertenenciaLineas(ctx.db, params.lineas);
  if (params.contraparteId) {
    const cp = await ctx.db.contraparte.findFirst({ where: { id: params.contraparteId } });
    if (!cp) throw new DomainError('Contraparte inexistente.');
  }

  const fecha = linea.fecha ?? new Date();
  const periodo = await getOrCreatePeriodo(ctx.db, fecha);
  if (periodo.estado === 'CERRADO') throw new DomainError('El período de la línea está cerrado: reabrilo para imputar.');

  // El signo lo define la categoría (INGRESO/EGRESO), como en todo el libro.
  // Movimiento + líneas de distribución en una sola escritura anidada: Prisma
  // la ejecuta atómicamente, así que nunca queda un ASIGNADO sin distribución.
  const mov = await ctx.db.movimiento.create({
    data: {
      origen: 'RESUMEN',
      estado: 'ASIGNADO',
      fechaDevengamiento: fecha,
      periodoId: periodo.id,
      categoriaId: categoria.id,
      contraparteId: params.contraparteId ?? null,
      descripcion: linea.descriptor,
      moneda: 'ARS', // la tarjeta/cuenta debitó pesos
      total: montoBase,
      canalIngreso: 'MANUAL',
      creadoPorId: ctx.usuario.id,
      validadoPorId: ctx.usuario.id,
      lineas: {
        createMany: {
          data: params.lineas.map((l) => ({
            centroCostoId: l.centroCostoId,
            clienteId: l.clienteId ?? null,
            proyectoId: l.proyectoId ?? null,
            porcentaje: l.porcentaje,
          })),
        },
      },
    } as never,
  });
  await ctx.db.resumenLineaVinculo.create({ data: { lineaId: linea.id, movimientoId: mov.id } });
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IMPUTADA', motivoIgnorada: null } });
  await aprenderDescriptor(ctx, params.contraparteId ?? null, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IMPUTAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: mov.id, total: montoBase, categoria: categoria.nombre },
  });
  // Espejo en el historial del movimiento: nace acá y sin este evento su
  // historial quedaría vacío (el evento de arriba cuelga del Resumen).
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'CREAR',
    despues: {
      origen: 'RESUMEN',
      desdeResumen: { resumenId: linea.resumenId, lineaId: linea.id, descriptor: linea.descriptor },
      total: montoBase,
      categoria: categoria.nombre,
      lineas: params.lineas,
    },
  });
}

type CandidatoGuardado = { movimientoId: string; score: number; motivo: string; rechazado?: boolean };

/**
 * Rechaza una sugerencia: marca el candidato como rechazado en la línea (el
 * re-match lo preserva y no lo vuelve a proponer) y recalcula el matching del
 * resumen, así la línea queda SUGERIDA con el siguiente candidato si también
 * calificaba, o PENDIENTE si no.
 */
export async function rechazarCandidato(ctx: EmpresaContext, params: { lineaId: string; movimientoId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  const candidatos = ((linea.candidatos as CandidatoGuardado[] | null) ?? []);
  const candidato = candidatos.find((c) => c.movimientoId === params.movimientoId && !c.rechazado);
  if (!candidato) throw new DomainError('Ese movimiento no es un candidato activo de la línea.');

  const nuevos = [...candidatos.filter((c) => c.movimientoId !== params.movimientoId), { ...candidato, rechazado: true }];
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { candidatos: nuevos as never } });
  await rematchearResumen(ctx.db, linea.resumenId);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_RECHAZAR_SUGERENCIA',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: params.movimientoId },
  });
}

export async function ignorarLinea(
  ctx: EmpresaContext,
  params: { lineaId: string; motivo: string; centroCostoId?: string | null },
): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  assertTitularVerificado(linea.resumen);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  const motivo = params.motivo.trim();
  if (!motivo) throw new DomainError('Indicá el motivo para ignorar la línea.');
  // Los motivos que computan al P&L son un cargo real: exigen centro de costo
  // (único, 100%) para que la vista por centro pueda atribuirlos.
  const computaPnl = (MOTIVOS_IGNORO_PNL as readonly string[]).includes(motivo);
  let centroCostoId: string | null = null;
  if (computaPnl) {
    if (!params.centroCostoId) throw new DomainError(`El motivo «${motivo}» computa en el P&L: elegí el centro de costo.`);
    const centro = await ctx.db.centroCosto.findFirst({ where: { id: params.centroCostoId } });
    if (!centro) throw new DomainError('Centro de costo inexistente.');
    centroCostoId = centro.id;
  }
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IGNORADA', motivoIgnorada: motivo, centroCostoId } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IGNORAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, motivo, ...(centroCostoId ? { centroCostoId } : {}) },
  });
}

export async function deshacerLinea(ctx: EmpresaContext, params: { lineaId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'PENDIENTE') return;
  // Imputación deshecha: el movimiento creado desde la línea se anula.
  const movImputado = linea.estado === 'IMPUTADA' ? linea.vinculos[0]?.movimientoId ?? null : null;
  if (movImputado) {
    const mov = await ctx.db.movimiento.findFirst({ where: { id: movImputado }, include: { periodo: true } });
    if (mov && mov.estado !== 'ANULADO') {
      if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento imputado está cerrado.');
      assertTransicion(mov.estado, 'ANULADO');
      await ctx.db.movimiento.update({
        where: { id: mov.id },
        data: { estado: 'ANULADO', motivoAnulacion: 'Imputación de resumen deshecha' },
      });
      // Espejo en el historial del movimiento (ver imputarLinea).
      await writeAudit(ctx.db, {
        usuarioId: ctx.usuario.id,
        entidad: 'Movimiento',
        entidadId: mov.id,
        accion: 'ANULAR',
        antes: { estado: mov.estado },
        despues: {
          estado: 'ANULADO',
          motivo: 'Imputación de resumen deshecha',
          desdeResumen: { resumenId: linea.resumenId, lineaId: linea.id },
        },
      });
    }
  }
  await ctx.db.resumenLineaVinculo.deleteMany({ where: { lineaId: linea.id } });
  await ctx.db.resumenLinea.update({
    where: { id: linea.id },
    data: { estado: 'PENDIENTE', motivoIgnorada: null, centroCostoId: null, reglaAplicada: null },
  });
  await sincronizarCobrosDeLinea(ctx, linea.id);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_DESHACER',
    antes: { lineaId: linea.id, estado: linea.estado, movimientoIds: linea.vinculos.map((v) => v.movimientoId) },
  });
}

/**
 * Un comprobante que se borra (duplicado) deja sin comprobante a las líneas
 * que lo tenían como único vínculo: vuelven a PENDIENTE. Se llama ANTES de
 * borrar el movimiento (los vínculos caen en cascada después).
 */
export async function liberarLineasDeMovimiento(ctx: EmpresaContext, movimientoId: string): Promise<void> {
  const vinculos = await ctx.db.resumenLineaVinculo.findMany({
    where: { movimientoId },
    include: { linea: { include: { vinculos: true } } },
  });
  for (const v of vinculos) {
    if (v.linea.vinculos.length === 1) {
      await ctx.db.resumenLinea.update({ where: { id: v.lineaId }, data: { estado: 'PENDIENTE', reglaAplicada: null } });
    }
  }
  await ctx.db.resumenLineaVinculo.deleteMany({ where: { movimientoId } });
  for (const lineaId of new Set(vinculos.map((v) => v.lineaId))) await sincronizarCobrosDeLinea(ctx, lineaId);
}

/**
 * Confirma a mano que un resumen marcado NO_COINCIDE sí pertenece a la
 * empresa (la verificación automática no encontró el CUIT ni la razón social
 * en el PDF, pero el usuario lo revisó).
 */
export async function confirmarTitularResumen(ctx: EmpresaContext, params: { resumenId: string }): Promise<void> {
  const resumen = await ctx.db.resumen.findFirst({ where: { id: params.resumenId } });
  if (!resumen) throw new DomainError('Resumen inexistente.');
  if (resumen.verificacionTitular === 'COINCIDE' || resumen.verificacionTitular === 'CONFIRMADA') return;
  await ctx.db.resumen.update({ where: { id: resumen.id }, data: { verificacionTitular: 'CONFIRMADA' } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'RESUMEN_CONFIRMAR_TITULAR',
    antes: { verificacionTitular: resumen.verificacionTitular, titularDetectado: resumen.titularDetectado },
    despues: { verificacionTitular: 'CONFIRMADA' },
  });
}

export const PALABRA_CONFIRMACION_ELIMINAR = 'ELIMINAR';

/**
 * Borra físicamente un resumen (subido a la empresa equivocada, PDF erróneo).
 * Doble validación: la palabra de confirmación viene del formulario y se
 * revalida acá. Sólo si ninguna línea tiene comprobantes vinculados: los
 * vínculos que se hicieron por error se deshacen primero (una imputación
 * deshecha anula el comprobante creado). Las líneas ignoradas no bloquean.
 * El archivo queda en el almacén inmutable. Auditado con lo identificatorio.
 */
export async function eliminarResumen(ctx: EmpresaContext, params: { resumenId: string; confirmacion: string }): Promise<void> {
  if (params.confirmacion.trim() !== PALABRA_CONFIRMACION_ELIMINAR) {
    throw new DomainError(`Para eliminar el resumen escribí ${PALABRA_CONFIRMACION_ELIMINAR} en el campo de confirmación.`);
  }
  const resumen = await ctx.db.resumen.findFirst({
    where: { id: params.resumenId },
    include: { periodo: true, lineas: { include: { vinculos: true } } },
  });
  if (!resumen) throw new DomainError('Resumen inexistente.');
  if (resumen.estado === 'PROCESANDO') throw new DomainError('El resumen se está procesando: esperá a que termine la extracción.');
  const conComprobantes = resumen.lineas.filter((l) => l.vinculos.length > 0);
  if (conComprobantes.length > 0) {
    throw new DomainError(
      `El resumen tiene ${conComprobantes.length} línea${conComprobantes.length !== 1 ? 's' : ''} con comprobantes vinculados: deshacelas primero (una imputación deshecha anula el comprobante creado).`,
    );
  }
  await ctx.db.resumen.delete({ where: { id: resumen.id } }); // las líneas caen en cascada
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'ELIMINAR',
    antes: {
      emisor: resumen.emisor,
      tipo: resumen.tipo,
      periodo: `${resumen.periodo.anio}-${String(resumen.periodo.mes).padStart(2, '0')}`,
      archivoNombre: resumen.archivoNombre,
      archivoKey: resumen.archivoKey,
      lineas: resumen.lineas.length,
      ignoradas: resumen.lineas.filter((l) => l.estado === 'IGNORADA').length,
      verificacionTitular: resumen.verificacionTitular,
      titularDetectado: resumen.titularDetectado,
    },
  });
}

const MONEDAS = ['ARS', 'USD', 'EUR', 'OTRA'] as const;

export type DatosLineaResumen = {
  lineaId: string;
  descriptor: string;
  fecha: Date | null;
  monto: number | null; // ARS FIRMADO: consumos negativos, pagos positivos
  moneda: string;
  montoOrigen?: number | null;
  cuotas?: string | null;
  cuenta?: string | null;
  titular?: string | null;
};

/**
 * Corrige a mano los datos capturados de una línea cuando el OCR/la extracción
 * falló. Sólo sobre líneas no resueltas (una resuelta se deshace primero: el
 * movimiento vinculado se armó con estos datos). Descriptor, fecha y monto son
 * la entrada del matching, así que después de guardar se recalcula: corregir
 * el importe suele hacer aparecer el movimiento que corresponde.
 */
export async function editarLinea(ctx: EmpresaContext, params: DatosLineaResumen): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  const descriptor = params.descriptor.trim();
  if (!descriptor) throw new DomainError('El descriptor de la línea no puede quedar vacío.');
  if (!(MONEDAS as readonly string[]).includes(params.moneda)) throw new DomainError('Moneda inválida.');

  const antes = {
    descriptor: linea.descriptor,
    fecha: linea.fecha,
    monto: linea.monto != null ? Number(linea.monto) : null,
    moneda: linea.moneda,
    montoOrigen: linea.montoOrigen != null ? Number(linea.montoOrigen) : null,
    cuotas: linea.cuotas,
    cuenta: linea.cuenta,
    titular: linea.titular,
  };
  const despues = {
    descriptor,
    fecha: params.fecha,
    monto: params.monto,
    moneda: params.moneda,
    montoOrigen: params.montoOrigen ?? null,
    cuotas: params.cuotas?.trim() || null,
    cuenta: params.cuenta?.trim() || null,
    titular: params.titular?.trim() || null,
  };

  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: despues as never });
  await rematchearResumen(ctx.db, linea.resumenId);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_EDITAR_LINEA',
    antes: { lineaId: linea.id, ...antes },
    despues: { lineaId: linea.id, ...despues },
  });
}
