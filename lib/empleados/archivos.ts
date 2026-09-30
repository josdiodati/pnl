import { prisma } from '@/lib/db';

// Log de archivos de recibos subidos. No hay tabla propia: cada subida encola
// un Job EXTRACCION_RECIBO por página (payload: archivoKey, archivoNombre,
// usuarioId, pagina) y el ReciboSueldo que nace de esa página guarda el mismo
// archivoKey + pagina. Juntando ambos se ve qué entró y qué no, por archivo.

export type JobRecibo = {
  id: string;
  estado: string; // queued | processing | done | failed
  error: string | null;
  createdAt: Date;
  payload: unknown;
};

export type ReciboDeArchivo = {
  id: string;
  archivoKey: string | null;
  pagina: number | null;
  estado: 'PENDIENTE_REVISION' | 'CONFIRMADO' | 'ANULADO';
  empleadoNombre: string;
  anio: number;
  mes: number;
};

export type EstadoPagina = 'CONFIRMADO' | 'PENDIENTE_REVISION' | 'ANULADO' | 'FALLIDA' | 'EN_COLA' | 'SIN_RECIBO';

export type PaginaArchivo = {
  pagina: number;
  estado: EstadoPagina;
  error: string | null;
  recibo: ReciboDeArchivo | null;
};

export type ArchivoRecibos = {
  archivoKey: string;
  archivoNombre: string;
  subidoAt: Date;
  usuarioId: string | null;
  paginas: PaginaArchivo[];
  conteo: Record<EstadoPagina, number>;
  periodos: { anio: number; mes: number; cantidad: number }[];
};

type Payload = { archivoKey?: string; archivoNombre?: string; usuarioId?: string; pagina?: number };

export function agruparArchivos(jobs: JobRecibo[], recibos: ReciboDeArchivo[]): ArchivoRecibos[] {
  const reciboPorPagina = new Map<string, ReciboDeArchivo>();
  for (const r of recibos) {
    if (r.archivoKey && r.pagina != null) reciboPorPagina.set(`${r.archivoKey}#${r.pagina}`, r);
  }

  const porArchivo = new Map<string, ArchivoRecibos>();
  for (const j of jobs) {
    const p = (j.payload ?? {}) as Payload;
    if (!p.archivoKey || p.pagina == null) continue;
    let a = porArchivo.get(p.archivoKey);
    if (!a) {
      a = {
        archivoKey: p.archivoKey,
        archivoNombre: p.archivoNombre ?? 'archivo.pdf',
        subidoAt: j.createdAt,
        usuarioId: p.usuarioId ?? null,
        paginas: [],
        conteo: { CONFIRMADO: 0, PENDIENTE_REVISION: 0, ANULADO: 0, FALLIDA: 0, EN_COLA: 0, SIN_RECIBO: 0 },
        periodos: [],
      };
      porArchivo.set(p.archivoKey, a);
    }
    if (j.createdAt < a.subidoAt) a.subidoAt = j.createdAt;

    const recibo = reciboPorPagina.get(`${p.archivoKey}#${p.pagina}`) ?? null;
    const estado: EstadoPagina = recibo
      ? recibo.estado
      : j.estado === 'failed'
        ? 'FALLIDA'
        : j.estado === 'done'
          ? 'SIN_RECIBO'
          : 'EN_COLA';
    a.paginas.push({ pagina: p.pagina, estado, error: estado === 'FALLIDA' ? j.error : null, recibo });
    a.conteo[estado]++;
  }

  const archivos = [...porArchivo.values()];
  for (const a of archivos) {
    a.paginas.sort((x, y) => x.pagina - y.pagina);
    const periodos = new Map<string, { anio: number; mes: number; cantidad: number }>();
    for (const pg of a.paginas) {
      if (!pg.recibo || pg.recibo.estado === 'ANULADO') continue;
      const k = `${pg.recibo.anio}-${pg.recibo.mes}`;
      const acc = periodos.get(k) ?? { anio: pg.recibo.anio, mes: pg.recibo.mes, cantidad: 0 };
      acc.cantidad++;
      periodos.set(k, acc);
    }
    a.periodos = [...periodos.values()].sort((x, y) => y.anio - x.anio || y.mes - x.mes);
  }
  return archivos.sort((x, y) => y.subidoAt.getTime() - x.subidoAt.getTime());
}

/** Archivos de recibos de la empresa, más nuevos primero, con quién los subió. */
export async function listarArchivosRecibos(
  empresaId: string,
): Promise<(ArchivoRecibos & { subidoPor: string | null })[]> {
  const jobs = await prisma.job.findMany({
    where: { tipo: 'EXTRACCION_RECIBO', empresaId },
    select: { id: true, estado: true, error: true, createdAt: true, payload: true },
  });
  const keys = [...new Set(jobs.map((j) => (j.payload as Payload | null)?.archivoKey).filter((k): k is string => !!k))];
  const recibos = keys.length
    ? await prisma.reciboSueldo.findMany({
        where: { empresaId, archivoKey: { in: keys } },
        select: {
          id: true, archivoKey: true, pagina: true, estado: true,
          empleado: { select: { nombre: true } },
          periodo: { select: { anio: true, mes: true } },
        },
      })
    : [];
  const archivos = agruparArchivos(
    jobs,
    recibos.map((r) => ({
      id: r.id, archivoKey: r.archivoKey, pagina: r.pagina, estado: r.estado,
      empleadoNombre: r.empleado.nombre, anio: r.periodo.anio, mes: r.periodo.mes,
    })),
  );
  const usuarioIds = [...new Set(archivos.map((a) => a.usuarioId).filter((u): u is string => !!u))];
  const usuarios = usuarioIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nombre: true, email: true } })
    : [];
  const nombre = new Map(usuarios.map((u) => [u.id, u.nombre || u.email]));
  return archivos.map((a) => ({ ...a, subidoPor: a.usuarioId ? nombre.get(a.usuarioId) ?? null : null }));
}
