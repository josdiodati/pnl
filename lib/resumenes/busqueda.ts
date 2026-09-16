import type { Prisma } from '@prisma/client';

// Estados desde los que un movimiento puede conciliarse con una línea de
// resumen (compartido entre el panel de conciliación y su buscador).
export const MOVIMIENTOS_CONCILIABLES = ['ASIGNADO', 'VALIDADO', 'PENDIENTE_VALIDACION'] as const;

/**
 * Where del buscador manual del panel de conciliación: movimientos en estado
 * conciliable, con texto libre sobre los mismos campos que la búsqueda del
 * libro. Sin texto, lista los más recientes. Los que ya tienen una línea de
 * resumen vinculada SÍ aparecen (un comprobante puede pagarse en varias
 * líneas): el buscador los marca y la conciliación exige confirmación. Los
 * nacidos de una imputación no se comparten, así que quedan afuera.
 */
export function buildWhereMovimientoConciliable(q: string): Prisma.MovimientoWhereInput {
  const where: Prisma.MovimientoWhereInput = {
    estado: { in: [...MOVIMIENTOS_CONCILIABLES] as never },
    vinculosResumen: { none: { linea: { estado: 'IMPUTADA' as never } } },
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
