import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { enqueueJob } from '@/lib/jobs';
import { writeAudit } from '@/lib/audit';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { normalizarCuit } from '@/lib/checks/cuit';
import { validarDistribucion } from '@/lib/movimientos/distribucion';
import { DomainError } from '@/lib/errors';
import { contarPaginasPdf, textoDePagina } from './pdf';
import { getReciboExtractor } from '@/lib/extractor/recibo';
import { verificarAritmeticaRecibo, calcularCostoTotal, type TotalesRecibo } from './aritmetica';
import { decidirEstadoRecibo } from './decision';

// Pipeline de recibos: PDF multi-recibo -> storage (una vez) -> un Job
// EXTRACCION_RECIBO por página -> el worker extrae, matchea por CUIL, corre la
// aritmética y decide estado. El ReciboSueldo nace DESPUÉS de la extracción
// (antes no se sabe de qué empleado es); el progreso se mira por la tabla Job.

export async function ingestarRecibos(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{ paginas: number }> {
  if (params.mime !== 'application/pdf') throw new DomainError('Los recibos se cargan como PDF.');
  const paginas = await contarPaginasPdf(params.buffer).catch(() => 0);
  if (!paginas) throw new DomainError('No se pudo leer el PDF de recibos.');

  const storage = getFileStorage();
  const { key } = await storage.put(params.buffer, {
    filename: params.filename,
    mime: params.mime,
    empresaId: params.empresaId,
  });

  for (let pagina = 1; pagina <= paginas; pagina++) {
    await enqueueJob(
      'EXTRACCION_RECIBO',
      {
        empresaId: params.empresaId,
        archivoKey: key,
        archivoNombre: params.filename,
        archivoMime: params.mime,
        pagina,
        usuarioId: params.usuarioId,
      },
      params.empresaId,
    );
  }
  return { paginas };
}

/** Extracción de UNA página del PDF de recibos (la corre el worker). */
export async function procesarExtraccionRecibo(payload: {
  empresaId: string;
  archivoKey: string;
  archivoNombre: string;
  archivoMime: string;
  pagina: number;
  usuarioId: string;
}): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const buffer = await getFileStorage().get(payload.archivoKey);
  const texto = await textoDePagina(buffer, payload.pagina);

  const { extraccion, uso } = await getReciboExtractor().extract({
    texto,
    buffer,
    mime: payload.archivoMime,
    pagina: payload.pagina,
  });

  const camposRevisar: Record<string, string> = {};

  // --- Empleado: matching por CUIL, alta automática si no existe ---
  const cuil = extraccion.cuil ? normalizarCuit(extraccion.cuil) : null;
  if (!cuil) throw new Error(`Página ${payload.pagina}: no se pudo extraer el CUIL del recibo`);
  let empleado = await db.empleado.findFirst({ where: { cuil }, include: { distribucion: true } });
  if (!empleado) {
    const creado = await db.empleado.create({
      data: {
        nombre: extraccion.nombre ?? `CUIL ${cuil}`,
        cuil,
        legajo: extraccion.legajo,
        categoria: extraccion.categoriaLaboral,
        sector: extraccion.sector,
        fechaIngreso: extraccion.fechaIngreso ? new Date(`${extraccion.fechaIngreso}T00:00:00Z`) : null,
      } as never,
    });
    await writeAudit(db, {
      entidad: 'Empleado',
      entidadId: creado.id,
      accion: 'CREAR',
      despues: { nombre: creado.nombre, cuil, desdeRecibo: true },
    });
    empleado = { ...creado, distribucion: [] };
    camposRevisar.empleado = 'Empleado nuevo dado de alta desde el recibo: revisá la ficha y cargale distribución';
  } else if (
    (extraccion.categoriaLaboral && empleado.categoria && extraccion.categoriaLaboral !== empleado.categoria) ||
    (extraccion.sector && empleado.sector && extraccion.sector !== empleado.sector)
  ) {
    // Drift de datos maestros: se flaggea, nunca se pisa la ficha en silencio.
    camposRevisar.empleado = 'La categoría o el sector del recibo difieren de la ficha del empleado';
  }

  // --- Período ---
  if (!extraccion.periodoAnio || !extraccion.periodoMes) {
    throw new Error(`Página ${payload.pagina}: no se pudo extraer el período del recibo`);
  }
  const fechaPeriodo = new Date(Date.UTC(extraccion.periodoAnio, extraccion.periodoMes - 1, 1));
  const periodo = await getOrCreatePeriodo(db, fechaPeriodo);

  // --- Totales + aritmética ---
  const totales: TotalesRecibo = {
    brutoRemunerativo: extraccion.brutoRemunerativo,
    noRemunerativo: extraccion.noRemunerativo,
    retenciones: extraccion.retenciones,
    sueldoNeto: extraccion.sueldoNeto,
    contribucionesEmpleador: extraccion.contribucionesEmpleador,
    costoTotalEmpleador: extraccion.costoTotalEmpleador,
  };
  if (totales.costoTotalEmpleador == null) {
    // El modelo de recibo no imprime el costo total: se calcula y se flaggea.
    const calculado = calcularCostoTotal(totales);
    if (calculado != null) {
      totales.costoTotalEmpleador = calculado;
      camposRevisar.costoTotalEmpleador = 'El recibo no imprime el costo total empleador: se calculó bruto + no rem + contribuciones';
    }
  }
  Object.assign(camposRevisar, verificarAritmeticaRecibo(totales));

  // --- Duplicado (guarda de código; ver plan, desviación 2) ---
  const preexistente = await db.reciboSueldo.findFirst({
    where: { empleadoId: empleado.id, periodoId: periodo.id, tipo: extraccion.tipo, estado: { not: 'ANULADO' } },
  });

  // --- Distribución de la ficha ---
  const lineasFicha = empleado.distribucion.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId ?? null,
    proyectoId: l.proyectoId ?? null,
    porcentaje: Number(l.porcentaje),
  }));
  let tieneDistribucion = false;
  try {
    validarDistribucion(lineasFicha);
    tieneDistribucion = true;
  } catch {
    /* ficha sin distribución completa */
  }

  const decision = decidirEstadoRecibo({
    camposRevisar,
    tieneDistribucion,
    periodoCerrado: periodo.estado === 'CERRADO',
    duplicado: preexistente != null,
  });

  const recibo = await db.reciboSueldo.create({
    data: {
      empleadoId: empleado.id,
      periodoId: periodo.id,
      tipo: extraccion.tipo,
      estado: decision.estado,
      nota: decision.nota,
      brutoRemunerativo: totales.brutoRemunerativo,
      noRemunerativo: totales.noRemunerativo,
      retenciones: totales.retenciones,
      sueldoNeto: totales.sueldoNeto,
      contribucionesEmpleador: totales.contribucionesEmpleador,
      costoTotalEmpleador: totales.costoTotalEmpleador,
      conceptos: extraccion.conceptos as never,
      archivoKey: payload.archivoKey,
      archivoNombre: payload.archivoNombre,
      archivoMime: payload.archivoMime,
      pagina: payload.pagina,
      extraccionRaw: extraccion as never,
      camposRevisar: camposRevisar as never,
      confianza: extraccion.confianza as never,
      tokensEntrada: uso?.entrada ?? null,
      tokensSalida: uso?.salida ?? null,
      tokensCacheCreacion: uso?.cacheCreacion ?? null,
      tokensCacheLectura: uso?.cacheLectura ?? null,
      modeloExtractor: uso?.modelo ?? null,
      confirmadoAt: decision.estado === 'CONFIRMADO' ? new Date() : null,
    } as never,
  });

  // CONFIRMADO directo hereda (copia) la distribución de la ficha.
  if (decision.estado === 'CONFIRMADO') {
    await prisma.reciboDistribucionLinea.createMany({
      data: lineasFicha.map((l) => ({
        reciboId: recibo.id,
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId,
        proyectoId: l.proyectoId,
        porcentaje: l.porcentaje,
      })),
    });
  }

  await writeAudit(db, {
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: decision.estado === 'CONFIRMADO' ? 'AUTO_CONFIRMAR' : decision.estado === 'ANULADO' ? 'AUTO_DUPLICADO' : 'EXTRAER',
    despues: {
      estado: decision.estado,
      empleado: empleado.nombre,
      periodo: `${extraccion.periodoAnio}-${extraccion.periodoMes}`,
      tipo: extraccion.tipo,
      costoTotalEmpleador: totales.costoTotalEmpleador,
      camposRevisar,
      pagina: payload.pagina,
    },
  });
}
