import type { Prisma } from '@prisma/client';

// Estados desde los que un movimiento puede conciliarse con una línea de
// resumen (compartido entre el panel de conciliación y su buscador).
export const MOVIMIENTOS_CONCILIABLES = ['ASIGNADO', 'VALIDADO', 'PENDIENTE_VALIDACION'] as const;

/**
 * Where del buscador manual del panel de conciliación: movimientos todavía
 * conciliables (sin línea de resumen conciliada/imputada encima), con texto
 * libre sobre los mismos campos que la búsqueda del libro. Sin texto, lista
 * los más recientes.
 */
export function buildWhereMovimientoConciliable(q: string): Prisma.MovimientoWhereInput {
  const where: Prisma.MovimientoWhereInput = {
    estado: { in: [...MOVIMIENTOS_CONCILIABLES] as never },
    lineasResumen: { none: { estado: { in: ['CONCILIADA', 'IMPUTADA'] as never } } },
  };
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
