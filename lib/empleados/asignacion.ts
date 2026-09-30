import { prisma } from '@/lib/db';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';

// Asignación PERMANENTE del empleado (centro / cliente / proyecto): vive en la
// ficha y rige mes a mes hasta que cambia. No se confirma todos los meses:
// - al ingerir un recibo, si la ficha está vacía se toma la del último recibo
//   confirmado y queda guardada en la ficha;
// - confirmar o reasignar el recibo MÁS RECIENTE del empleado actualiza la
//   ficha (el cambio rige para los meses siguientes). Corregir un mes viejo no
//   la toca.

type Periodo = { anio: number; mes: number };

function aLineas(
  filas: { centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: unknown }[],
): LineaDistribucion[] {
  return filas.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId ?? null,
    proyectoId: l.proyectoId ?? null,
    porcentaje: Number(l.porcentaje),
  }));
}

/** Líneas del último recibo confirmado (por período) que tenga distribución. */
export async function distribucionUltimoRecibo(empleadoId: string): Promise<LineaDistribucion[]> {
  const recibos = await prisma.reciboSueldo.findMany({
    where: { empleadoId, estado: 'CONFIRMADO', lineas: { some: {} } },
    include: { lineas: true },
    orderBy: [{ periodo: { anio: 'desc' } }, { periodo: { mes: 'desc' } }, { confirmadoAt: 'desc' }],
    take: 1,
  });
  return recibos[0] ? aLineas(recibos[0].lineas) : [];
}

/**
 * Distribución vigente del empleado: la de la ficha; si la ficha está vacía,
 * la del último recibo confirmado, que además se guarda en la ficha.
 */
export async function distribucionVigente(
  empleadoId: string,
): Promise<{ lineas: LineaDistribucion[]; origen: 'ficha' | 'recibo' | null }> {
  const ficha = await prisma.empleadoDistribucionLinea.findMany({ where: { empleadoId } });
  if (ficha.length) return { lineas: aLineas(ficha), origen: 'ficha' };
  const lineas = await distribucionUltimoRecibo(empleadoId);
  if (!lineas.length) return { lineas, origen: null };
  await reemplazarFicha(empleadoId, lineas);
  return { lineas, origen: 'recibo' };
}

async function reemplazarFicha(empleadoId: string, lineas: LineaDistribucion[]): Promise<void> {
  await prisma.$transaction([
    prisma.empleadoDistribucionLinea.deleteMany({ where: { empleadoId } }),
    prisma.empleadoDistribucionLinea.createMany({
      data: lineas.map((l) => ({
        empleadoId,
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: l.porcentaje,
      })),
    }),
  ]);
}

/**
 * Tras confirmar/reasignar un recibo: si no hay un recibo confirmado del
 * empleado en un período posterior, su distribución pasa a ser la de la ficha.
 * Devuelve true si la ficha cambió.
 */
export async function actualizarFichaSiEsUltimo(
  empleadoId: string,
  periodo: Periodo,
  lineas: LineaDistribucion[],
): Promise<boolean> {
  const posterior = await prisma.reciboSueldo.findFirst({
    where: {
      empleadoId,
      estado: 'CONFIRMADO',
      OR: [
        { periodo: { anio: { gt: periodo.anio } } },
        { periodo: { anio: periodo.anio, mes: { gt: periodo.mes } } },
      ],
    },
    select: { id: true },
  });
  if (posterior) return false;
  const actual = aLineas(await prisma.empleadoDistribucionLinea.findMany({ where: { empleadoId } }));
  if (mismaDistribucion(actual, lineas)) return false;
  await reemplazarFicha(empleadoId, lineas);
  return true;
}

export function mismaDistribucion(a: LineaDistribucion[], b: LineaDistribucion[]): boolean {
  const clave = (ls: LineaDistribucion[]) =>
    ls
      .map((l) => `${l.centroCostoId}|${l.clienteId ?? ''}|${l.proyectoId ?? ''}|${Number(l.porcentaje).toFixed(4)}`)
      .sort()
      .join(';');
  return clave(a) === clave(b);
}
