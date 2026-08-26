import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { validarDistribucion, type LineaDistribucion } from '@/lib/movimientos/distribucion';
import { validarPertenenciaLineas } from '@/lib/movimientos/service';
import { getOrCreatePeriodo } from '@/lib/periodos';
import type { TotalesRecibo } from './aritmetica';

// Acciones de usuario sobre empleados y recibos. Todas asumen que el caller ya
// pasó por requireEmpresa(slug, 'ADMINISTRADOR'). Un período CERRADO congela
// recibos y vínculos (misma regla que movimientos).

export function validarMontoVinculo(totalCentavos: number, existentesCentavos: number, nuevoCentavos: number): void {
  if (nuevoCentavos <= 0) throw new DomainError('El monto vinculado debe ser mayor a 0.');
  if (existentesCentavos + nuevoCentavos > totalCentavos) {
    throw new DomainError('La suma de los montos vinculados supera el total del comprobante.');
  }
}

async function reciboEditable(ctx: EmpresaContext, reciboId: string) {
  const recibo = await ctx.db.reciboSueldo.findFirst({ where: { id: reciboId }, include: { periodo: true, empleado: { include: { distribucion: true } } } });
  if (!recibo) throw new DomainError('Recibo inexistente.');
  if (recibo.periodo.estado === 'CERRADO') throw new DomainError('El período del recibo está cerrado.');
  return recibo;
}

export async function confirmarRecibo(
  ctx: EmpresaContext,
  reciboId: string,
  cambios: { lineas?: LineaDistribucion[]; totales?: Partial<TotalesRecibo> },
): Promise<void> {
  const recibo = await reciboEditable(ctx, reciboId);
  if (recibo.estado !== 'PENDIENTE_REVISION') throw new DomainError('Sólo se confirma un recibo pendiente de revisión.');

  // Distribución efectiva: la del form, o la copia de la ficha.
  const lineas = cambios.lineas?.length
    ? cambios.lineas
    : recibo.empleado.distribucion.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
  validarDistribucion(lineas);
  await validarPertenenciaLineas(ctx.db, lineas);

  const t = cambios.totales ?? {};
  if ((t.costoTotalEmpleador ?? (recibo.costoTotalEmpleador != null ? Number(recibo.costoTotalEmpleador) : null)) == null) {
    throw new DomainError('El recibo necesita un costo total empleador para confirmarse.');
  }

  await ctx.db.reciboSueldo.update({
    where: { id: recibo.id },
    data: {
      estado: 'CONFIRMADO',
      confirmadoAt: new Date(),
      camposRevisar: {} as never,
      nota: null,
      ...(t.brutoRemunerativo !== undefined ? { brutoRemunerativo: t.brutoRemunerativo } : {}),
      ...(t.noRemunerativo !== undefined ? { noRemunerativo: t.noRemunerativo } : {}),
      ...(t.retenciones !== undefined ? { retenciones: t.retenciones } : {}),
      ...(t.sueldoNeto !== undefined ? { sueldoNeto: t.sueldoNeto } : {}),
      ...(t.contribucionesEmpleador !== undefined ? { contribucionesEmpleador: t.contribucionesEmpleador } : {}),
      ...(t.costoTotalEmpleador !== undefined ? { costoTotalEmpleador: t.costoTotalEmpleador } : {}),
    },
  });
  await prisma.reciboDistribucionLinea.deleteMany({ where: { reciboId: recibo.id } });
  await prisma.reciboDistribucionLinea.createMany({
    data: lineas.map((l) => ({
      reciboId: recibo.id,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: 'CONFIRMAR',
    antes: { estado: recibo.estado },
    despues: { estado: 'CONFIRMADO', lineas: lineas.length, totalesEditados: Object.keys(t) },
  });
}

export async function anularRecibo(ctx: EmpresaContext, reciboId: string, nota: string): Promise<void> {
  const recibo = await reciboEditable(ctx, reciboId);
  if (recibo.estado === 'ANULADO') throw new DomainError('El recibo ya está anulado.');
  await ctx.db.reciboSueldo.update({ where: { id: recibo.id }, data: { estado: 'ANULADO', nota: nota || 'Anulado manualmente' } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: 'ANULAR',
    antes: { estado: recibo.estado },
    despues: { estado: 'ANULADO', nota },
  });
}

export async function guardarFichaEmpleado(
  ctx: EmpresaContext,
  empleadoId: string,
  datos: { nombre: string; legajo?: string | null; categoria?: string | null; sector?: string | null; fechaEgreso?: string | null; activo: boolean },
): Promise<void> {
  const empleado = await ctx.db.empleado.findFirst({ where: { id: empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');
  if (!datos.nombre.trim()) throw new DomainError('El nombre no puede quedar vacío.');
  await ctx.db.empleado.update({
    where: { id: empleadoId },
    data: {
      nombre: datos.nombre.trim(),
      legajo: datos.legajo || null,
      categoria: datos.categoria || null,
      sector: datos.sector || null,
      fechaEgreso: datos.fechaEgreso ? new Date(`${datos.fechaEgreso}T00:00:00Z`) : null,
      activo: datos.activo,
    },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: empleadoId,
    accion: 'EDITAR',
    antes: { nombre: empleado.nombre, activo: empleado.activo },
    despues: datos,
  });
}

export async function guardarDistribucionEmpleado(ctx: EmpresaContext, empleadoId: string, lineas: LineaDistribucion[]): Promise<void> {
  const empleado = await ctx.db.empleado.findFirst({ where: { id: empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');
  validarDistribucion(lineas);
  await validarPertenenciaLineas(ctx.db, lineas);
  await prisma.empleadoDistribucionLinea.deleteMany({ where: { empleadoId } });
  await prisma.empleadoDistribucionLinea.createMany({
    data: lineas.map((l) => ({
      empleadoId,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: empleadoId,
    accion: 'DISTRIBUCION',
    despues: { lineas: lineas.map((l) => ({ cc: l.centroCostoId, pct: l.porcentaje })) },
  });
}

/**
 * Costo individual de SEGUIMIENTO por empleado y período (ej. su plan de
 * prepaga). No impacta el P&L: el gasto real ya entra una vez por la factura
 * agregada (categoría marcada "es costo de personal").
 */
export async function agregarCostoManual(
  ctx: EmpresaContext,
  params: { empleadoId: string; anio: number; mes: number; concepto: string; monto: number },
): Promise<void> {
  const empleado = await ctx.db.empleado.findFirst({ where: { id: params.empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');
  if (!params.concepto.trim()) throw new DomainError('El concepto es obligatorio.');
  if (!(params.monto > 0)) throw new DomainError('El monto debe ser mayor a 0.');
  if (!(params.mes >= 1 && params.mes <= 12) || !Number.isInteger(params.anio)) {
    throw new DomainError('Período inválido.');
  }
  const periodo = await getOrCreatePeriodo(ctx.db, new Date(Date.UTC(params.anio, params.mes - 1, 1)));
  const costo = await prisma.costoManualEmpleado.create({
    data: { empleadoId: params.empleadoId, periodoId: periodo.id, concepto: params.concepto.trim(), monto: params.monto },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: params.empleadoId,
    accion: 'COSTO_MANUAL_ALTA',
    despues: { costoId: costo.id, periodo: `${params.anio}-${params.mes}`, concepto: params.concepto, monto: params.monto },
  });
}

export async function eliminarCostoManual(ctx: EmpresaContext, params: { empleadoId: string; costoId: string }): Promise<void> {
  const costo = await ctx.db.costoManualEmpleado.findFirst({
    where: { id: params.costoId, empleadoId: params.empleadoId },
  });
  if (!costo) throw new DomainError('El costo no existe.');
  await ctx.db.costoManualEmpleado.delete({ where: { id: costo.id } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: params.empleadoId,
    accion: 'COSTO_MANUAL_BAJA',
    antes: { costoId: costo.id, concepto: costo.concepto, monto: Number(costo.monto) },
  });
}

export async function vincularMovimiento(
  ctx: EmpresaContext,
  params: { movimientoId: string; empleadoId: string; monto: number },
): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId }, include: { periodo: true, vinculosEmpleados: true } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.total == null) throw new DomainError('El movimiento no tiene total: no se puede vincular.');
  if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento está cerrado.');
  const empleado = await ctx.db.empleado.findFirst({ where: { id: params.empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');

  const nuevoCentavos = Math.round(params.monto * 100);
  const existentes = mov.vinculosEmpleados
    .filter((v) => v.empleadoId !== params.empleadoId)
    .reduce((acc, v) => acc + Math.round(Number(v.monto) * 100), 0);
  validarMontoVinculo(Math.round(Number(mov.total) * 100), existentes, nuevoCentavos);

  // El cliente scoped no soporta upsert: findFirst + create/update.
  const previo = await ctx.db.movimientoEmpleado.findFirst({ where: { movimientoId: params.movimientoId, empleadoId: params.empleadoId } });
  if (previo) {
    await ctx.db.movimientoEmpleado.update({ where: { id: previo.id }, data: { monto: params.monto } });
  } else {
    await prisma.movimientoEmpleado.create({ data: { movimientoId: params.movimientoId, empleadoId: params.empleadoId, monto: params.monto } });
  }
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: params.movimientoId,
    accion: 'VINCULAR_EMPLEADO',
    despues: { empleado: empleado.nombre, monto: params.monto },
  });
}

export async function desvincularMovimiento(ctx: EmpresaContext, params: { movimientoId: string; empleadoId: string }): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId }, include: { periodo: true } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento está cerrado.');
  const vinculo = await ctx.db.movimientoEmpleado.findFirst({ where: { movimientoId: params.movimientoId, empleadoId: params.empleadoId } });
  if (!vinculo) throw new DomainError('El vínculo no existe.');
  await ctx.db.movimientoEmpleado.delete({ where: { id: vinculo.id } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: params.movimientoId,
    accion: 'DESVINCULAR_EMPLEADO',
    despues: { empleadoId: params.empleadoId },
  });
}
