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
  await enqueueJob('EXTRACCION_RESUMEN', { resumenId: resumen.id, empresaId: params.empresaId }, params.empresaId);
  return { resumenId: resumen.id };
}

/** Candidatos de matching para una fecha dada (ventana ±45 días). */
async function candidatosDeMatching(db: ScopedDb): Promise<MovimientoCandidato[]> {
  const movs = await db.movimiento.findMany({
    where: { estado: { notIn: ['ANULADO', 'DUPLICADO'] } },
    include: { contraparte: true, lineasResumen: { where: { estado: 'CONCILIADA' }, select: { id: true } } },
  });
  return movs
    .filter((m) => m.lineasResumen.length === 0) // un movimiento admite una sola línea conciliada
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

  const periodo = await getOrCreatePeriodo(db, new Date(Date.UTC(extraccion.periodoAnio, extraccion.periodoMes - 1, 1)));
  const candidatos = await candidatosDeMatching(db);

  // Reemplaza líneas previas (reintento de extracción): sólo las no resueltas.
  await prisma.resumenLinea.deleteMany({ where: { resumenId: resumen.id, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });

  let orden = 0;
  for (const linea of extraccion.lineas) {
    const fecha = linea.fecha ? new Date(`${linea.fecha}T00:00:00Z`) : null;
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

/** Recalcula el matching de las líneas no resueltas (botón "Re-matchear"). */
export async function rematchearResumen(db: ScopedDb, resumenId: string): Promise<void> {
  const lineas = await db.resumenLinea.findMany({ where: { resumenId, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });
  const candidatos = await candidatosDeMatching(db);
  for (const l of lineas) {
    const evaluacion = evaluarLinea(
      { fecha: l.fecha, descriptor: l.descriptor, monto: l.monto != null ? Number(l.monto) : null, montoOrigen: l.montoOrigen != null ? Number(l.montoOrigen) : null, moneda: l.moneda },
      candidatos,
    );
    await db.resumenLinea.update({
      where: { id: l.id },
      data: { estado: evaluacion.estado as never, candidatos: evaluacion.candidatos as never },
    });
  }
}
