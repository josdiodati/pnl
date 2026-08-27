import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { validarDistribucion, type LineaDistribucion } from '@/lib/movimientos/distribucion';
import { validarPertenenciaLineas } from '@/lib/movimientos/service';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { assertTransicion } from '@/lib/movimientos/estados';
import { normalizarDescriptor } from './matching';

// Acciones sobre líneas de resumen. Conciliar NO crea gasto (el movimiento ya
// está en el libro): acá muere el doble conteo. Imputar crea el gasto tomando
// la línea como base (origen RESUMEN, nace ASIGNADO). Todo auditado.

async function lineaOrThrow(ctx: EmpresaContext, lineaId: string) {
  const linea = await ctx.db.resumenLinea.findFirst({ where: { id: lineaId }, include: { resumen: true } });
  if (!linea) throw new DomainError('Línea de resumen inexistente.');
  return linea;
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

export async function conciliarLinea(ctx: EmpresaContext, params: { lineaId: string; movimientoId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.estado === 'ANULADO' || mov.estado === 'DUPLICADO') throw new DomainError('Ese movimiento está anulado o duplicado.');
  const yaConciliado = await ctx.db.resumenLinea.findFirst({
    where: { movimientoId: mov.id, estado: { in: ['CONCILIADA', 'IMPUTADA'] }, id: { not: linea.id } },
  });
  if (yaConciliado) throw new DomainError('Ese movimiento ya está conciliado con otra línea.');

  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'CONCILIADA', movimientoId: mov.id, motivoIgnorada: null } });
  await aprenderDescriptor(ctx, mov.contraparteId, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_CONCILIAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: mov.id },
  });
}

export async function imputarLinea(
  ctx: EmpresaContext,
  params: { lineaId: string; categoriaId: string; lineas: LineaDistribucion[]; contraparteId?: string | null; montoArs?: number | null },
): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
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
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IMPUTADA', movimientoId: mov.id, motivoIgnorada: null } });
  await aprenderDescriptor(ctx, params.contraparteId ?? null, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IMPUTAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: mov.id, total: montoBase, categoria: categoria.nombre },
  });
}

export async function ignorarLinea(ctx: EmpresaContext, params: { lineaId: string; motivo: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado !== 'PENDIENTE' && linea.estado !== 'SUGERIDA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  if (!params.motivo.trim()) throw new DomainError('Indicá el motivo para ignorar la línea.');
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IGNORADA', motivoIgnorada: params.motivo.trim() } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IGNORAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, motivo: params.motivo },
  });
}

export async function deshacerLinea(ctx: EmpresaContext, params: { lineaId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'PENDIENTE') return;
  // Imputación deshecha: el movimiento creado desde la línea se anula.
  if (linea.estado === 'IMPUTADA' && linea.movimientoId) {
    const mov = await ctx.db.movimiento.findFirst({ where: { id: linea.movimientoId }, include: { periodo: true } });
    if (mov && mov.estado !== 'ANULADO') {
      if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento imputado está cerrado.');
      assertTransicion(mov.estado, 'ANULADO');
      await ctx.db.movimiento.update({
        where: { id: mov.id },
        data: { estado: 'ANULADO', motivoAnulacion: 'Imputación de resumen deshecha' },
      });
    }
  }
  await ctx.db.resumenLinea.update({
    where: { id: linea.id },
    data: { estado: 'PENDIENTE', movimientoId: null, motivoIgnorada: null },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_DESHACER',
    antes: { lineaId: linea.id, estado: linea.estado, movimientoId: linea.movimientoId },
  });
}
