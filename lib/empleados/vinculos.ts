import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { ScopedDb } from '@/lib/empresa/scope';
import { writeAudit } from '@/lib/audit';
import { netoDe } from '@/lib/movimientos/neto';

// Vínculos comprobante → empleado (adicionales de salario, prepagas…). El
// período del vínculo es SIEMPRE el del comprobante (no se elige: evita
// errores); el monto por defecto es el neto, sin IVA ni percepciones.

/** Monto a vincular por defecto: el neto del comprobante (sin IVA,
 *  percepciones ni otros tributos; el mismo "Neto" de todas las vistas). En la
 *  moneda del comprobante. */
export function montoVinculableDe(mov: Parameters<typeof netoDe>[0]): number | null {
  const neto = netoDe(mov);
  return neto != null && neto > 0 ? Math.round(neto * 100) / 100 : null;
}

/** La categoría "Adicionales Salarios" (o "Adicionales de Salario") habilita
 *  elegir el empleado al asignar. Se reconoce por nombre: no hay otra marca. */
export function esCategoriaAdicionalesSalario(nombre: string | null | undefined): boolean {
  if (!nombre) return false;
  const n = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /adicional(es)?\s+(de\s+)?salario/.test(n);
}

/** Comprobantes vinculables desde la ficha: asignados con total, texto libre
 *  sobre los mismos campos que el buscador del libro. */
export function buildWhereComprobanteVinculable(q: string): Prisma.MovimientoWhereInput {
  const where: Prisma.MovimientoWhereInput = { estado: 'ASIGNADO', total: { not: null } };
  const texto = q.trim();
  if (texto) {
    const contains = { contains: texto, mode: 'insensitive' as const };
    where.OR = [
      { descripcion: contains },
      { numero: contains },
      { cuitEmisor: contains },
      { archivoNombre: contains },
      { contraparte: { razonSocial: contains } },
      { contraparte: { cuit: contains } },
    ];
  }
  return where;
}

/**
 * Vínculo automático por regla (lo corre el pipeline cuando la regla que
 * asignó el comprobante tiene empleado): monto = neto gravado. No pisa un
 * vínculo existente ni supera el total del comprobante. Devuelve si vinculó.
 */
export async function vincularPorRegla(
  db: ScopedDb,
  params: { movimientoId: string; empleadoId: string; regla: string },
): Promise<boolean> {
  const mov = await db.movimiento.findFirst({ where: { id: params.movimientoId }, include: { vinculosEmpleados: true } });
  const empleado = await db.empleado.findFirst({ where: { id: params.empleadoId } });
  if (!mov || !empleado || mov.total == null) return false;
  if (mov.vinculosEmpleados.some((v) => v.empleadoId === params.empleadoId)) return false;
  const monto = montoVinculableDe(mov);
  if (monto == null) return false;
  const yaVinculado = mov.vinculosEmpleados.reduce((a, v) => a + Number(v.monto), 0);
  const disponible = Number(mov.total) - yaVinculado;
  const final = Math.min(monto, disponible);
  if (final <= 0) return false;
  await prisma.movimientoEmpleado.create({
    data: { movimientoId: mov.id, empleadoId: empleado.id, monto: Math.round(final * 100) / 100 },
  });
  await writeAudit(db, {
    usuarioId: null,
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'VINCULAR_EMPLEADO',
    despues: { empleado: empleado.nombre, monto: final, porRegla: params.regla },
  });
  return true;
}
