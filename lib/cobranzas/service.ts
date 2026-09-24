import { randomUUID } from 'node:crypto';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { assertTransicion } from '@/lib/movimientos/estados';
import { ORIGENES_VENTA } from '@/lib/ventas/query';
import { INCLUDE_COBRANZA, aVentaCobrable } from './query';
import { esCobrable, saldoVenta, tcFactura } from './estado';
import { calcularReparto, type InstrumentoReparto, type ResultadoReparto } from './reparto';

// Servicio de cobranzas (Spec F). El cobro no toca el P&L: sólo el ajuste por
// diferencia de cambio de facturas en moneda extranjera (asiento en la
// categoría "Diferencia de cambio", fecha del cobro, distribución de la
// factura). Todo auditado en el grupo (entidad Cobro) y espejado en el
// historial de cada venta.

export const CATEGORIA_DIFERENCIA_CAMBIO = 'Diferencia de cambio';
export const INSTRUMENTOS = ['TRANSFERENCIA', 'CHEQUE', 'ECHEQ', 'EFECTIVO', 'RETENCION', 'NOTA_CREDITO', 'OTRO'] as const;
export type Instrumento = (typeof INSTRUMENTOS)[number];
export const INSTRUMENTO_LABEL: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia',
  CHEQUE: 'Cheque',
  ECHEQ: 'E-cheq',
  EFECTIVO: 'Efectivo',
  RETENCION: 'Retención',
  NOTA_CREDITO: 'Nota de crédito',
  OTRO: 'Otro',
};
/** Instrumentos que pasan por el banco (se concilian con el resumen y entran en la proyección). */
export const INSTRUMENTOS_BANCARIOS = new Set(['TRANSFERENCIA', 'CHEQUE', 'ECHEQ', 'OTRO']);
const ES_CHEQUE = new Set(['CHEQUE', 'ECHEQ']);

type Db = EmpresaContext['db'];

async function cargarVentas(db: Db, ids: string[]) {
  const ventas = await db.movimiento.findMany({
    where: { id: { in: ids } },
    include: { ...INCLUDE_COBRANZA, lineas: true },
  });
  if (ventas.length !== new Set(ids).size) throw new DomainError('Alguna de las ventas no existe en esta empresa.');
  for (const v of ventas) {
    if (!(ORIGENES_VENTA as readonly string[]).includes(v.origen)) throw new DomainError('Sólo se registran cobros de ventas.');
  }
  return ventas;
}
type VentaCargada = Awaited<ReturnType<typeof cargarVentas>>[number];

function etiquetaVenta(v: { tipoComprobante: string | null; puntoVenta: string | null; numero: string | null }): string {
  const tipo = v.tipoComprobante?.replace(/_/g, ' ') ?? 'Venta';
  return `${tipo} ${v.puntoVenta ? `${v.puntoVenta}-` : ''}${v.numero ?? ''}`.trim();
}

// ---------- Ajuste por diferencia de cambio ----------

async function categoriaDiferenciaCambio(db: Db): Promise<string> {
  const existente = await db.categoria.findFirst({ where: { nombre: CATEGORIA_DIFERENCIA_CAMBIO } });
  if (existente) return existente.id;
  const creada = await db.categoria.create({ data: { nombre: CATEGORIA_DIFERENCIA_CAMBIO, tipo: 'INGRESO' } as never });
  return creada.id;
}

async function assertPeriodoAbiertoPara(db: Db, fecha: Date, que: string): Promise<string> {
  const periodo = await getOrCreatePeriodo(db, fecha);
  if (periodo.estado === 'CERRADO') {
    throw new DomainError(`El período ${periodo.mes}/${periodo.anio} está cerrado: reabrilo para ${que}.`);
  }
  return periodo.id;
}

async function crearAjusteCambio(ctx: EmpresaContext, venta: VentaCargada, diferencia: number, fecha: Date, grupo: string): Promise<string> {
  const periodoId = await assertPeriodoAbiertoPara(ctx.db, fecha, 'registrar la diferencia de cambio del cobro');
  const categoriaId = await categoriaDiferenciaCambio(ctx.db);
  const conDistribucion = venta.lineas.length > 0;
  const estado = conDistribucion ? 'ASIGNADO' : 'PENDIENTE_VALIDACION';
  const mov = await ctx.db.movimiento.create({
    data: {
      origen: 'ASIENTO_MANUAL',
      estado,
      canalIngreso: 'MANUAL',
      fechaDevengamiento: fecha,
      periodoId,
      categoriaId,
      contraparteId: venta.contraparteId,
      descripcion: `Diferencia de cambio al cobrar ${etiquetaVenta(venta)}`,
      moneda: 'ARS',
      total: diferencia,
      relacionadoId: venta.id,
      creadoPorId: ctx.usuario.id,
      validadoPorId: conDistribucion ? ctx.usuario.id : null,
      flags: { ajusteCambio: { grupo, ventaId: venta.id } } as never,
      ...(conDistribucion
        ? {
            lineas: {
              createMany: {
                data: venta.lineas.map((l) => ({
                  centroCostoId: l.centroCostoId,
                  clienteId: l.clienteId,
                  proyectoId: l.proyectoId,
                  porcentaje: l.porcentaje,
                  origen: l.origen,
                })),
              },
            },
          }
        : {}),
    } as never,
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'CREAR',
    despues: { origen: 'ASIENTO_MANUAL', estado, total: diferencia, categoria: CATEGORIA_DIFERENCIA_CAMBIO, relacionadoId: venta.id, ajusteCambio: { grupo } },
  });
  return mov.id;
}

async function anularAjuste(ctx: EmpresaContext, ajusteId: string, motivo: string): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id: ajusteId }, include: { periodo: true } });
  if (!mov || mov.estado === 'ANULADO') return;
  if (mov.periodo?.estado === 'CERRADO') {
    throw new DomainError(`El ajuste por diferencia de cambio está en un período cerrado (${mov.periodo.mes}/${mov.periodo.anio}): reabrilo primero.`);
  }
  assertTransicion(mov.estado, 'ANULADO');
  await ctx.db.movimiento.update({ where: { id: mov.id }, data: { estado: 'ANULADO', motivoAnulacion: motivo } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'ANULAR',
    antes: { estado: mov.estado },
    despues: { estado: 'ANULADO', motivo },
  });
}

// ---------- Alta de cobros (común a manual y banco) ----------

function estadoInicial(instrumento: string, origen: 'MANUAL' | 'RESUMEN'): 'EN_CARTERA' | 'ACREDITADO' {
  return origen === 'MANUAL' && ES_CHEQUE.has(instrumento) ? 'EN_CARTERA' : 'ACREDITADO';
}

/**
 * Persiste un reparto ya calculado: un Cobro por instrumento (mismo grupo),
 * sus aplicaciones, y los ajustes de cambio. Devuelve el grupo.
 */
export async function persistirReparto(
  ctx: EmpresaContext,
  params: {
    ventas: VentaCargada[];
    reparto: ResultadoReparto;
    origen: 'MANUAL' | 'RESUMEN';
    resumenLineaId?: string | null;
    nota?: string | null;
    grupo?: string;
  },
): Promise<string> {
  const grupo = params.grupo ?? randomUUID();
  const porId = new Map(params.ventas.map((v) => [v.id, v]));
  const clientes = new Set(params.ventas.map((v) => v.contraparteId));
  const contraparteId = clientes.size === 1 ? [...clientes][0] : null;

  // Diferencias de cambio agregadas por venta (una venta puede recibir de
  // varios instrumentos): un asiento por venta por grupo. Se validan los
  // períodos ANTES de escribir nada.
  const difPorVenta = new Map<string, number>();
  for (const ins of params.reparto.instrumentos) {
    for (const a of ins.aplicaciones) difPorVenta.set(a.movimientoId, Math.round(((difPorVenta.get(a.movimientoId) ?? 0) + a.diferenciaCambioArs) * 100) / 100);
  }
  const fechaAjuste = params.reparto.instrumentos[0]?.fecha ?? new Date();
  if ([...difPorVenta.values()].some((d) => Math.abs(d) >= 1)) {
    await assertPeriodoAbiertoPara(ctx.db, fechaAjuste, 'registrar la diferencia de cambio del cobro');
  }

  const ajustePorVenta = new Map<string, string>();
  for (const [ventaId, dif] of difPorVenta) {
    if (Math.abs(dif) < 1) continue;
    ajustePorVenta.set(ventaId, await crearAjusteCambio(ctx, porId.get(ventaId)!, dif, fechaAjuste, grupo));
  }

  const ajusteAsignado = new Set<string>();
  for (const ins of params.reparto.instrumentos) {
    const cobro = await ctx.db.cobro.create({
      data: {
        grupo,
        origen: params.origen,
        contraparteId,
        instrumento: ins.instrumento as never,
        estado: estadoInicial(ins.instrumento, params.origen),
        fecha: ins.fecha,
        fechaAcreditacion: ins.fechaAcreditacion,
        moneda: ins.moneda as never,
        monto: ins.monto,
        tipoCambio: ins.moneda === 'ARS' && params.reparto.moneda !== 'ARS' ? params.reparto.cotizacion : null,
        numero: ins.numero?.trim() || null,
        banco: ins.banco?.trim() || null,
        nota: params.nota?.trim() || null,
        resumenLineaId: params.resumenLineaId ?? null,
        creadoPorId: ctx.usuario.id,
      } as never,
    });
    for (const a of ins.aplicaciones) {
      // El asiento de ajuste cuelga de la primera aplicación de esa venta.
      const ajusteId = !ajusteAsignado.has(a.movimientoId) ? ajustePorVenta.get(a.movimientoId) ?? null : null;
      if (ajusteId) ajusteAsignado.add(a.movimientoId);
      await ctx.db.cobroAplicacion.create({
        data: { cobroId: cobro.id, movimientoId: a.movimientoId, importe: a.importe, importeArs: a.importeArs, ajusteId },
      });
    }
  }

  const resumenInstrumentos = params.reparto.instrumentos.map((i) => ({
    instrumento: i.instrumento, monto: i.monto, moneda: i.moneda, fechaAcreditacion: i.fechaAcreditacion, numero: i.numero ?? null,
  }));
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Cobro',
    entidadId: grupo,
    accion: 'COBRO_REGISTRAR',
    despues: {
      origen: params.origen,
      resumenLineaId: params.resumenLineaId ?? null,
      instrumentos: resumenInstrumentos,
      ventas: params.ventas.map((v) => v.id),
      cotizacion: params.reparto.cotizacion,
      ajustes: Object.fromEntries(ajustePorVenta),
    },
  });
  for (const v of params.ventas) {
    const aplicado = params.reparto.instrumentos.flatMap((i) => i.aplicaciones).filter((a) => a.movimientoId === v.id).reduce((s, a) => s + a.importe, 0);
    if (aplicado <= 0) continue;
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Movimiento',
      entidadId: v.id,
      accion: 'COBRO_REGISTRAR',
      despues: {
        grupo,
        origen: params.origen,
        aplicado: Math.round(aplicado * 100) / 100,
        moneda: v.moneda,
        instrumentos: resumenInstrumentos,
        diferenciaCambio: difPorVenta.get(v.id) ?? 0,
      },
    });
  }
  return grupo;
}

function facturasParaReparto(ventas: VentaCargada[], omitirGrupo?: string) {
  return ventas.map((v) => {
    const cobrable = aVentaCobrable({
      ...v,
      aplicacionesCobro: omitirGrupo ? v.aplicacionesCobro.filter((a) => a.cobro.grupo !== omitirGrupo) : v.aplicacionesCobro,
    });
    return { id: v.id, fecha: v.fechaDevengamiento, saldo: saldoVenta(cobrable).saldo, moneda: v.moneda, tcFactura: tcFactura(cobrable), cobrable };
  });
}

// ---------- Registrar cobro (manual) ----------

export type DatosRegistrarCobro = {
  ventaIds: string[];
  instrumentos: InstrumentoReparto[];
  cotizacion?: number | null;
  cerrarDiferenciaComoRetencion?: boolean;
  nota?: string | null;
};

export async function registrarCobro(ctx: EmpresaContext, datos: DatosRegistrarCobro): Promise<string> {
  const ids = [...new Set(datos.ventaIds)];
  if (ids.length === 0) throw new DomainError('Elegí al menos una venta.');
  for (const i of datos.instrumentos) {
    if (!(INSTRUMENTOS as readonly string[]).includes(i.instrumento)) throw new DomainError('Instrumento de cobro inválido.');
    if (Number.isNaN(i.fecha.getTime()) || Number.isNaN(i.fechaAcreditacion.getTime())) throw new DomainError('Fecha inválida en un instrumento.');
  }
  const ventas = await cargarVentas(ctx.db, ids);
  const facturas = facturasParaReparto(ventas);
  for (const f of facturas) {
    if (!esCobrable(f.cobrable)) throw new DomainError('Una de las ventas no es cobrable (anulada, nota de crédito o sin total).');
    if (f.saldo <= 0) throw new DomainError('Una de las ventas ya está cobrada por completo.');
  }
  const reparto = calcularReparto({
    facturas,
    instrumentos: datos.instrumentos,
    cotizacion: datos.cotizacion ?? null,
    cerrarDiferenciaComoRetencion: datos.cerrarDiferenciaComoRetencion,
  });
  return persistirReparto(ctx, { ventas, reparto, origen: 'MANUAL', nota: datos.nota });
}

/** Cierra el saldo de una venta en pesos como retención sufrida (un clic). */
export async function cerrarSaldoComoRetencion(ctx: EmpresaContext, ventaId: string, fecha?: Date): Promise<string> {
  const [venta] = await cargarVentas(ctx.db, [ventaId]);
  const [f] = facturasParaReparto([venta]);
  if (!esCobrable(f.cobrable)) throw new DomainError('La venta no es cobrable.');
  if (venta.moneda !== 'ARS') throw new DomainError('Sólo el saldo de una venta en pesos se cierra como retención.');
  if (f.saldo <= 0) throw new DomainError('La venta no tiene saldo.');
  const dia = fecha ?? new Date();
  const reparto = calcularReparto({
    facturas: [f],
    instrumentos: [{ instrumento: 'RETENCION', monto: f.saldo, moneda: 'ARS', fecha: dia, fechaAcreditacion: dia }],
  });
  return persistirReparto(ctx, { ventas: [venta], reparto, origen: 'MANUAL', nota: 'Saldo cerrado como retención' });
}

// ---------- Eliminar / cheques ----------

/** Deshace un cobro (el grupo completo) y anula sus ajustes de cambio. */
export async function eliminarCobroGrupo(ctx: EmpresaContext, grupo: string, opts: { desdeResumen?: boolean } = {}): Promise<void> {
  const cobros = await ctx.db.cobro.findMany({ where: { grupo }, include: { aplicaciones: true } });
  if (cobros.length === 0) throw new DomainError('Cobro inexistente.');
  if (!opts.desdeResumen && cobros.some((c) => c.resumenLineaId)) {
    throw new DomainError('El cobro está confirmado por una línea del resumen bancario: deshacé la conciliación de esa línea primero.');
  }
  if (!opts.desdeResumen && cobros.some((c) => c.origen === 'RESUMEN')) {
    throw new DomainError('Ese cobro nació de conciliar el resumen: se deshace desde la línea del resumen.');
  }
  const ajustes = cobros.flatMap((c) => c.aplicaciones.map((a) => a.ajusteId)).filter((x): x is string => Boolean(x));
  for (const id of ajustes) await anularAjuste(ctx, id, 'Cobro deshecho');
  const ventas = [...new Set(cobros.flatMap((c) => c.aplicaciones.map((a) => a.movimientoId)))];
  await ctx.db.cobro.deleteMany({ where: { grupo } }); // aplicaciones en cascada
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Cobro',
    entidadId: grupo,
    accion: 'COBRO_ELIMINAR',
    antes: {
      instrumentos: cobros.map((c) => ({ instrumento: c.instrumento, monto: Number(c.monto), moneda: c.moneda, estado: c.estado, numero: c.numero })),
      ventas,
      ajustesAnulados: ajustes,
    },
  });
  for (const v of ventas) {
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Movimiento',
      entidadId: v,
      accion: 'COBRO_ELIMINAR',
      antes: { grupo, instrumentos: cobros.map((c) => ({ instrumento: c.instrumento, monto: Number(c.monto), moneda: c.moneda })) },
      despues: opts.desdeResumen ? { desdeResumen: true } : undefined,
    });
  }
}

async function chequeOrThrow(ctx: EmpresaContext, cobroId: string) {
  const c = await ctx.db.cobro.findFirst({ where: { id: cobroId }, include: { aplicaciones: true } });
  if (!c) throw new DomainError('Cobro inexistente.');
  if (!ES_CHEQUE.has(c.instrumento)) throw new DomainError('Sólo los cheques y e-cheqs cambian de estado.');
  return c;
}

export async function acreditarCheque(ctx: EmpresaContext, cobroId: string, fecha?: Date): Promise<void> {
  const c = await chequeOrThrow(ctx, cobroId);
  if (c.estado === 'ACREDITADO') return;
  const fechaAcreditacion = fecha ?? c.fechaAcreditacion;
  await ctx.db.cobro.update({ where: { id: c.id }, data: { estado: 'ACREDITADO', fechaAcreditacion } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id, entidad: 'Cobro', entidadId: c.grupo, accion: 'COBRO_CHEQUE_ACREDITAR',
    antes: { cobroId: c.id, estado: c.estado }, despues: { estado: 'ACREDITADO', fechaAcreditacion },
  });
}

/** Un cheque rechazado deja de cancelar saldo: la factura vuelve a deberse. */
export async function rechazarCheque(ctx: EmpresaContext, cobroId: string, motivo?: string): Promise<void> {
  const c = await chequeOrThrow(ctx, cobroId);
  if (c.estado === 'RECHAZADO') return;
  if (c.resumenLineaId) throw new DomainError('El cheque figura acreditado en el resumen bancario: deshacé esa conciliación primero.');
  for (const a of c.aplicaciones) if (a.ajusteId) await anularAjuste(ctx, a.ajusteId, 'Cheque rechazado');
  await ctx.db.cobro.update({ where: { id: c.id }, data: { estado: 'RECHAZADO', nota: motivo?.trim() || c.nota } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id, entidad: 'Cobro', entidadId: c.grupo, accion: 'COBRO_CHEQUE_RECHAZAR',
    antes: { cobroId: c.id, estado: c.estado }, despues: { estado: 'RECHAZADO', motivo: motivo ?? null },
  });
  for (const a of c.aplicaciones) {
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id, entidad: 'Movimiento', entidadId: a.movimientoId, accion: 'COBRO_CHEQUE_RECHAZAR',
      despues: { grupo: c.grupo, numero: c.numero, monto: Number(c.monto), motivo: motivo ?? null },
    });
  }
}

// ---------- Fecha probable / plazo del cliente ----------

export async function fijarFechaProbable(ctx: EmpresaContext, ventaId: string, fecha: Date | null): Promise<void> {
  const [venta] = await cargarVentas(ctx.db, [ventaId]);
  if (fecha && Number.isNaN(fecha.getTime())) throw new DomainError('Fecha inválida.');
  await ctx.db.movimiento.update({ where: { id: venta.id }, data: { fechaCobroEstimada: fecha } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id, entidad: 'Movimiento', entidadId: venta.id, accion: 'COBRO_FECHA_PROBABLE',
    antes: { fechaCobroEstimada: venta.fechaCobroEstimada }, despues: { fechaCobroEstimada: fecha },
  });
}

export async function fijarPlazoCliente(ctx: EmpresaContext, contraparteId: string, dias: number | null): Promise<void> {
  if (dias != null && (!Number.isInteger(dias) || dias < 0 || dias > 365)) throw new DomainError('El plazo de cobro va de 0 a 365 días.');
  const c = await ctx.db.contraparte.findFirst({ where: { id: contraparteId } });
  if (!c) throw new DomainError('Contraparte inexistente.');
  await ctx.db.contraparte.update({ where: { id: c.id }, data: { plazoCobroDias: dias } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id, entidad: 'Contraparte', entidadId: c.id, accion: 'EDITAR',
    antes: { plazoCobroDias: c.plazoCobroDias }, despues: { plazoCobroDias: dias },
  });
}

/** Guardia para anular una venta: con cobros aplicados primero se deshacen. */
export async function assertSinCobros(db: Db, movimientoId: string): Promise<void> {
  const n = await db.cobroAplicacion.count({ where: { movimientoId, cobro: { estado: { not: 'RECHAZADO' } } } });
  if (n > 0) throw new DomainError('La venta tiene cobros registrados: eliminalos antes de anularla.');
}

export { cargarVentas, facturasParaReparto };
export type { VentaCargada };
