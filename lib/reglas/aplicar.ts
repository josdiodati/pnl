import type { ReglaAsignacion } from '@prisma/client';
import type { ScopedDb } from '@/lib/empresa/scope';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';

// Resuelve la acción de una regla a una asignación concreta (categoría + líneas).
// Precedencia de fuente de líneas: plantilla de distribución > centro único > vacío.

export async function resolverAsignacionDeRegla(
  db: ScopedDb,
  regla: Pick<ReglaAsignacion, 'categoriaId' | 'distribucionId' | 'centroCostoId' | 'clienteId' | 'proyectoId'>,
): Promise<{ categoriaId: string | null; lineas: LineaDistribucion[] }> {
  let lineas: LineaDistribucion[] = [];
  if (regla.distribucionId) {
    const plantilla = await db.plantillaDistribucion.findFirst({
      where: { id: regla.distribucionId },
      include: { lineas: true },
    });
    if (plantilla) {
      lineas = plantilla.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
    }
  } else if (regla.centroCostoId) {
    lineas = [{
      centroCostoId: regla.centroCostoId,
      clienteId: regla.clienteId ?? null,
      proyectoId: regla.proyectoId ?? null,
      porcentaje: 100,
    }];
  }
  return { categoriaId: regla.categoriaId ?? null, lineas };
}
