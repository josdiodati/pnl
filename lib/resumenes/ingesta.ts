import { prisma } from '@/lib/db';
import { scopedDb, type ScopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { enqueueJob } from '@/lib/jobs';
import { writeAudit } from '@/lib/audit';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { DomainError } from '@/lib/errors';
import { getResumenExtractor } from '@/lib/extractor/resumen';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { evaluarLinea, normalizarDescriptor, type MovimientoCandidato } from './matching';

// Pipeline de resúmenes: PDF -> Resumen PROCESANDO -> Job EXTRACCION_RESUMEN
// -> worker extrae líneas -> matching automático -> EXTRAIDO. El período se
// crea al extraer (el que declara el propio resumen).

export async function ingestarResumen(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
  tipo: 'TARJETA' | 'BANCO';
  emisor: string;
}): Promise<{ resumenId: string }> {
  if (params.mime !== 'application/pdf') throw new DomainError('Los resúmenes se cargan como PDF.');
  if (!params.emisor.trim()) throw new DomainError('Indicá el banco/tarjeta emisor.');
  const db = scopedDb(params.empresaId);
  const storage = getFileStorage();
  const { key, hash } = await storage.put(params.buffer, { filename: params.filename, mime: params.mime, empresaId: params.empresaId });

  // Mismo archivo ya subido (hash): se rechaza — un resumen no se re-sube.
  const existente = await db.resumen.findFirst({ where: { archivoHash: hash }, select: { id: true, emisor: true } });
  if (existente) throw new DomainError(`Ese archivo ya fue subido (resumen de ${existente.emisor}).`);

  // El período definitivo lo declara el resumen; hasta extraer se ancla al mes actual.
  const periodo = await getOrCreatePeriodo(db, new Date());
  const resumen = await db.resumen.create({
    data: {
      tipo: params.tipo,
      emisor: params.emisor.trim(),
      periodoId: periodo.id,
      archivoKey: key,
      archivoNombre: params.filename,
      archivoMime: params.mime,
      archivoHash: hash,
    } as never,
  });
  await writeAudit(db, {
    usuarioId: params.usuarioId,
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'CREAR',
    despues: { tipo: params.tipo, emisor: params.emisor, archivo: params.filename, hash },
  });
  await enqueueJob('EXTRACCION_RESUMEN', { resumenId: resumen.id, empresaId: params.empresaId, usuarioId: params.usuarioId }, params.empresaId);
  return { resumenId: resumen.id };
}

const DIA_MS = 24 * 60 * 60 * 1000;
const VENTANA_MATCHING_DIAS = 45;

/**
 * Ventana [min−45d, max+45d] a partir de las fechas de las líneas del
 * resumen (el mismo dato que compara `señalFecha`). Si ninguna línea trae
 * fecha, se ancla al mes del período del resumen.
 */
function ventanaMatching(fechas: (Date | null | undefined)[], ancla: Date): { desde: Date; hasta: Date } {
  const validas = fechas.filter((f): f is Date => f != null);
  const base = validas.length ? validas : [ancla];
  const min = Math.min(...base.map((f) => f.getTime()));
  const max = Math.max(...base.map((f) => f.getTime()));
  return { desde: new Date(min - VENTANA_MATCHING_DIAS * DIA_MS), hasta: new Date(max + VENTANA_MATCHING_DIAS * DIA_MS) };
}

/** Candidatos de matching dentro de la ventana ±45 días de las líneas del resumen. */
async function candidatosDeMatching(db: ScopedDb, ventana: { desde: Date; hasta: Date }): Promise<MovimientoCandidato[]> {
  const movs = await db.movimiento.findMany({
    where: {
      estado: { notIn: ['ANULADO', 'DUPLICADO'] },
      // Misma fecha que compara señalFecha: fechaDevengamiento, o createdAt si no la tiene.
      OR: [
        { fechaDevengamiento: { gte: ventana.desde, lte: ventana.hasta } },
        { AND: [{ fechaDevengamiento: null }, { createdAt: { gte: ventana.desde, lte: ventana.hasta } }] },
      ],
    },
    include: { contraparte: true, lineasResumen: { where: { estado: { in: ['CONCILIADA', 'IMPUTADA'] } }, select: { id: true } } },
  });
  return movs
    .filter((m) => m.lineasResumen.length === 0) // un movimiento admite una sola línea ocupante (conciliada o imputada)
    .map((m) => ({
      id: m.id,
      total: m.total != null ? Number(m.total) : null,
      moneda: m.moneda,
      fecha: m.fechaDevengamiento ?? m.createdAt,
      nombreContraparte: nombreContraparte(m).nombre,
      descriptores: ((m.contraparte?.descriptoresResumen as string[] | null) ?? []).map(normalizarDescriptor),
    }));
}

export async function procesarExtraccionResumen(payload: { resumenId: string; empresaId: string }): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const resumen = await db.resumen.findFirst({ where: { id: payload.resumenId } });
  if (!resumen) throw new Error(`Resumen ${payload.resumenId} inexistente`);

  const buffer = await getFileStorage().get(resumen.archivoKey);
  const { extractText, getDocumentProxy } = await import('unpdf');
  let texto: string | null = null;
  try {
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const r = await extractText(doc, { mergePages: true });
    texto = r.text as string;
  } catch {
    texto = null;
  }

  const { extraccion, uso } = await getResumenExtractor().extract({ texto, buffer, mime: resumen.archivoMime });

  const anclaPeriodo = new Date(Date.UTC(extraccion.periodoAnio, extraccion.periodoMes - 1, 1));
  const periodo = await getOrCreatePeriodo(db, anclaPeriodo);
  const fechasLineas = extraccion.lineas.map((l) => (l.fecha ? new Date(`${l.fecha}T00:00:00Z`) : null));
  const candidatos = await candidatosDeMatching(db, ventanaMatching(fechasLineas, anclaPeriodo));

  // Reemplaza líneas previas (reintento de extracción): sólo las no resueltas.
  await prisma.resumenLinea.deleteMany({ where: { resumenId: resumen.id, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });

  let orden = 0;
  for (let i = 0; i < extraccion.lineas.length; i++) {
    const linea = extraccion.lineas[i];
    const fecha = fechasLineas[i];
    const evaluacion = evaluarLinea(
      { fecha, descriptor: linea.descriptor, monto: linea.monto, montoOrigen: linea.montoOrigen, moneda: linea.moneda },
      candidatos,
    );
    await prisma.resumenLinea.create({
      data: {
        resumenId: resumen.id,
        orden: orden++,
        fecha,
        descriptor: linea.descriptor,
        monto: linea.monto,
        moneda: linea.moneda as never,
        montoOrigen: linea.montoOrigen,
        cuotas: linea.cuotas,
        cuenta: linea.cuenta,
        titular: linea.titular,
        estado: evaluacion.estado as never,
        candidatos: evaluacion.candidatos as never,
      },
    });
  }

  await db.resumen.update({
    where: { id: resumen.id },
    data: {
      estado: 'EXTRAIDO',
      periodoId: periodo.id,
      tipo: extraccion.tipo as never,
      fechaCierre: extraccion.fechaCierre ? new Date(`${extraccion.fechaCierre}T00:00:00Z`) : null,
      totalDeclarado: extraccion.totalDeclarado,
      extraccionRaw: extraccion as never,
      tokensEntrada: uso?.entrada ?? null,
      tokensSalida: uso?.salida ?? null,
      tokensCacheCreacion: uso?.cacheCreacion ?? null,
      tokensCacheLectura: uso?.cacheLectura ?? null,
      modeloExtractor: uso?.modelo ?? null,
    },
  });
  await writeAudit(db, {
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'EXTRAER',
    despues: { lineas: extraccion.lineas.length, periodo: `${extraccion.periodoAnio}-${extraccion.periodoMes}`, totalDeclarado: extraccion.totalDeclarado },
  });
}

/** Hook de fallo final: el worker marca el resumen como ERROR_PROCESAMIENTO. */
export async function marcarErrorProcesamientoResumen(payload: { resumenId: string; empresaId: string }, error: string): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const resumen = await db.resumen.findFirst({ where: { id: payload.resumenId } });
  if (!resumen || resumen.estado === 'ERROR_PROCESAMIENTO') return;
  await db.resumen.update({ where: { id: resumen.id }, data: { estado: 'ERROR_PROCESAMIENTO', nota: error } });
  await writeAudit(db, { entidad: 'Resumen', entidadId: resumen.id, accion: 'ERROR_PROCESAMIENTO', despues: { error } });
}

type CandidatoGuardado = { movimientoId: string; score: number; motivo: string; rechazado?: boolean };

/**
 * Recalcula el matching de las líneas no resueltas (botón "Re-matchear").
 * Los candidatos RECHAZADOS por el usuario se preservan al final de la lista
 * y quedan excluidos de la evaluación: un rechazo no se vuelve a sugerir.
 */
export async function rematchearResumen(db: ScopedDb, resumenId: string): Promise<void> {
  const resumen = await db.resumen.findFirst({ where: { id: resumenId }, include: { periodo: true } });
  if (!resumen) throw new DomainError('Resumen inexistente.');
  const lineas = await db.resumenLinea.findMany({ where: { resumenId, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });
  const anclaPeriodo = new Date(Date.UTC(resumen.periodo.anio, resumen.periodo.mes - 1, 1));
  const candidatos = await candidatosDeMatching(db, ventanaMatching(lineas.map((l) => l.fecha), anclaPeriodo));
  for (const l of lineas) {
    const rechazados = (((l.candidatos as CandidatoGuardado[] | null) ?? [])).filter((c) => c.rechazado);
    const rechazadoIds = new Set(rechazados.map((c) => c.movimientoId));
    const evaluacion = evaluarLinea(
      { fecha: l.fecha, descriptor: l.descriptor, monto: l.monto != null ? Number(l.monto) : null, montoOrigen: l.montoOrigen != null ? Number(l.montoOrigen) : null, moneda: l.moneda },
      candidatos.filter((c) => !rechazadoIds.has(c.id)),
    );
    await db.resumenLinea.update({
      where: { id: l.id },
      data: { estado: evaluacion.estado as never, candidatos: [...evaluacion.candidatos, ...rechazados] as never },
    });
  }
}
