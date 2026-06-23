import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { getExtractor } from '@/lib/extractor';
import { getArca } from '@/lib/arca';
import { evaluarCampos, buscarDuplicados, normalizarCuit } from '@/lib/checks';
import { assertTransicion } from '@/lib/movimientos/estados';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { writeAudit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { leerQrAfip } from '@/lib/extractor/qr';

// The single ingestion pipeline shared by ALL channels (web, photo, email,
// telegram): store immutable file -> Movimiento INGRESADO -> Job EXTRACCION ->
// worker extracts -> deterministic checks -> contraparte matching -> ARCA ->
// PENDIENTE_VALIDACION (or RETENIDO if the accrual period is closed).

/** Determina si un comprobante es una compra (emisor tercero) o una venta
 *  emitida por la propia empresa (emisor === CUIT de la empresa). */
export function clasificarDireccion(
  cuitEmisor: string | null,
  _cuitReceptor: string | null,
  cuitEmpresa: string | null,
): 'COMPRA' | 'VENTA' {
  if (cuitEmisor && cuitEmpresa && cuitEmisor === cuitEmpresa) return 'VENTA';
  return 'COMPRA';
}

export type CanalIngreso = 'WEB' | 'FOTO' | 'EMAIL' | 'TELEGRAM' | 'MANUAL';

export async function ingestarComprobante(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
  canal: CanalIngreso;
}): Promise<{ movimientoId: string }> {
  const db = scopedDb(params.empresaId);
  const storage = getFileStorage();
  const { key, hash } = await storage.put(params.buffer, {
    filename: params.filename,
    mime: params.mime,
    empresaId: params.empresaId,
  });

  const movimiento = await db.movimiento.create({
    data: {
      origen: 'COMPROBANTE',
      estado: 'INGRESADO',
      canalIngreso: params.canal,
      archivoKey: key,
      archivoNombre: params.filename,
      archivoMime: params.mime,
      archivoHash: hash,
      creadoPorId: params.usuarioId,
    } as never,
  });

  await writeAudit(db, {
    usuarioId: params.usuarioId,
    entidad: 'Movimiento',
    entidadId: movimiento.id,
    accion: 'CREAR',
    despues: { origen: 'COMPROBANTE', canal: params.canal, archivo: params.filename, hash },
  });

  await enqueueJob('EXTRACCION', { movimientoId: movimiento.id, empresaId: params.empresaId }, params.empresaId);
  return { movimientoId: movimiento.id };
}

/** Runs the OCR/LLM extraction for one movement (executed by the worker). */
export async function procesarExtraccion(payload: { movimientoId: string; empresaId: string }): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const mov = await db.movimiento.findFirst({ where: { id: payload.movimientoId } });
  if (!mov) throw new Error(`Movimiento ${payload.movimientoId} inexistente`);
  if (!mov.archivoKey) throw new Error('Movimiento sin archivo para procesar');

  if (mov.estado !== 'PROCESANDO') {
    assertTransicion(mov.estado, 'PROCESANDO');
    await db.movimiento.update({ where: { id: mov.id }, data: { estado: 'PROCESANDO' } });
  }

  const buffer = await getFileStorage().get(mov.archivoKey);

  // Per-supplier extraction instructions, if the issuer is already known from
  // a previous attempt (doc 04: deterministic learning without retraining).
  let instrucciones: string | null = null;
  if (mov.cuitEmisor) {
    const previa = await db.contraparte.findFirst({ where: { cuit: mov.cuitEmisor } });
    instrucciones = previa?.instruccionesExtraccion ?? null;
  }

  const extraccion = await getExtractor().extract({
    buffer,
    mime: mov.archivoMime ?? 'application/pdf',
    filename: mov.archivoNombre ?? 'comprobante',
    instrucciones,
  });

  const cuit = extraccion.cuitEmisor ? normalizarCuit(extraccion.cuitEmisor) : null;
  const camposRevisar = evaluarCampos(extraccion);

  // Dirección: venta (emisor = empresa) vs compra (emisor tercero)
  const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId } });
  const cuitEmpresa = empresa?.cuit ? normalizarCuit(empresa.cuit) : null;
  const cuitReceptor = extraccion.cuitReceptor ? normalizarCuit(extraccion.cuitReceptor) : null;
  const direccion = clasificarDireccion(cuit, cuitReceptor, cuitEmpresa);
  const origenFinal: 'COMPROBANTE' | 'VENTA_COMPROBANTE' =
    direccion === 'VENTA' ? 'VENTA_COMPROBANTE' : 'COMPROBANTE';

  // En ventas, la contraparte es el RECEPTOR (cliente); en compras, el EMISOR (proveedor).
  const cuitContraparte = direccion === 'VENTA' ? cuitReceptor : cuit;
  const contraparte = cuitContraparte
    ? await db.contraparte.findFirst({ where: { cuit: cuitContraparte, activa: true } })
    : null;
  if (!contraparte && cuitContraparte) {
    camposRevisar.contraparte = 'Contraparte nueva: no está en el maestro';
  }

  // Cross-check best-effort del QR de AFIP (solo verificación, no bloquea)
  let qrAfip: unknown = null;
  if (mov.archivoMime === 'application/pdf') {
    const qr = await leerQrAfip(buffer);
    if (qr) {
      qrAfip = qr;
      const difs: string[] = [];
      if (cuit && String(qr.cuit) !== cuit) difs.push('CUIT emisor');
      if (extraccion.numero && Number(extraccion.numero) !== qr.nroCmp) difs.push('número');
      if (extraccion.total != null && Math.abs(qr.importe - extraccion.total) > 1) difs.push('importe');
      if (extraccion.cae && qr.codAut && extraccion.cae !== String(qr.codAut)) difs.push('CAE');
      if (difs.length) camposRevisar.qr = `QR AFIP no coincide: ${difs.join(', ')}`;
    }
  }

  // Re-check instructions now that we know the issuer (first attempt case)
  if (contraparte?.instruccionesExtraccion && !instrucciones) {
    // Already extracted without instructions; flag so the validator double-checks.
    camposRevisar.instrucciones = 'Este emisor tiene instrucciones de extracción; revisá los campos corregidos.';
  }

  const duplicados = await buscarDuplicados(
    db as never,
    {
      cuitEmisor: cuit,
      tipoComprobante: extraccion.tipoComprobante,
      puntoVenta: extraccion.puntoVenta,
      numero: extraccion.numero,
    },
    mov.id,
  );

  const fechaDevengamiento = extraccion.fechaEmision ? new Date(`${extraccion.fechaEmision}T00:00:00Z`) : null;
  let periodoId: string | null = null;
  let estadoFinal: 'PENDIENTE_VALIDACION' | 'RETENIDO' = 'PENDIENTE_VALIDACION';
  if (fechaDevengamiento) {
    const periodo = await getOrCreatePeriodo(db, fechaDevengamiento);
    periodoId = periodo.id;
    if (periodo.estado === 'CERRADO') estadoFinal = 'RETENIDO';
  }
  assertTransicion('PROCESANDO', estadoFinal);

  const flags: Record<string, unknown> = { ...(mov.flags as object | null ?? {}) };
  if (duplicados.length) flags.duplicados = duplicados.map((d) => d.id);

  await db.movimiento.update({
    where: { id: mov.id },
    data: {
      estado: estadoFinal,
      fechaDevengamiento,
      periodoId,
      cuitEmisor: cuit,
      contraparteId: contraparte?.id ?? null,
      categoriaId: contraparte?.categoriaDefaultId ?? null,
      descripcion: extraccion.razonSocialEmisor ? `Comprobante de ${extraccion.razonSocialEmisor}` : mov.descripcion,
      moneda: extraccion.moneda,
      tipoComprobante: extraccion.tipoComprobante,
      puntoVenta: extraccion.puntoVenta,
      numero: extraccion.numero,
      cae: extraccion.cae,
      vencimientoCae: extraccion.vencimientoCae ? new Date(`${extraccion.vencimientoCae}T00:00:00Z`) : null,
      netoGravado: extraccion.netoGravado,
      iva21: extraccion.iva21,
      iva105: extraccion.iva105,
      iva27: extraccion.iva27,
      percepcionesIva: extraccion.percepcionesIva,
      percepcionesIibb: extraccion.percepcionesIibb,
      otrosTributos: extraccion.otrosTributos,
      noGravadoExento: extraccion.noGravadoExento,
      total: extraccion.total,
      origen: origenFinal,
      extraccionRaw: { ...extraccion, qrAfip } as never,
      camposRevisar: camposRevisar as never,
      confianza: (extraccion.confianza ?? {}) as never,
      flags: flags as never,
    },
  });

  // Pre-create assignment lines from the supplier's default distribution
  if (contraparte?.distribucionDefaultId) {
    const plantilla = await db.plantillaDistribucion.findFirst({
      where: { id: contraparte.distribucionDefaultId },
      include: { lineas: true },
    });
    if (plantilla && plantilla.lineas.length) {
      await prisma.movimientoLinea.deleteMany({ where: { movimientoId: mov.id } });
      await prisma.movimientoLinea.createMany({
        data: plantilla.lineas.map((l) => ({
          movimientoId: mov.id,
          centroCostoId: l.centroCostoId,
          clienteProyectoId: l.clienteProyectoId,
          porcentaje: l.porcentaje,
        })),
      });
    }
  }

  await writeAudit(db, {
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'EXTRAER',
    despues: { estado: estadoFinal, camposRevisar, duplicados: duplicados.map((d) => d.id), contraparte: contraparte?.razonSocial ?? null },
  });

  if (extraccion.cae) {
    await enqueueJob('ARCA', { movimientoId: mov.id, empresaId: payload.empresaId }, payload.empresaId);
  }
}

/** Verifies the voucher against ARCA and stores the badge state. */
export async function procesarArca(payload: { movimientoId: string; empresaId: string }): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const mov = await db.movimiento.findFirst({ where: { id: payload.movimientoId } });
  if (!mov) throw new Error(`Movimiento ${payload.movimientoId} inexistente`);

  const resultado = await getArca().constatar({
    cuitEmisor: mov.cuitEmisor ?? '',
    tipoComprobante: mov.tipoComprobante ?? 'OTRO',
    puntoVenta: Number(mov.puntoVenta ?? 0),
    numero: Number(mov.numero ?? 0),
    fecha: mov.fechaDevengamiento?.toISOString().slice(0, 10) ?? '',
    importeTotal: Number(mov.total ?? 0),
    cae: mov.cae ?? '',
  });

  await db.movimiento.update({
    where: { id: mov.id },
    data: {
      arcaEstado: resultado.estado,
      arcaDetalle: resultado.detalle ?? null,
      arcaConsultadoAt: resultado.consultadoAt,
    },
  });

  await writeAudit(db, {
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'ARCA_CONSTATAR',
    despues: { estado: resultado.estado, detalle: resultado.detalle },
  });
}

/** Final-failure hook: the worker flips the movement to ERROR_PROCESAMIENTO. */
export async function marcarErrorProcesamiento(payload: { movimientoId: string; empresaId: string }, error: string): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const mov = await db.movimiento.findFirst({ where: { id: payload.movimientoId } });
  if (!mov || mov.estado === 'ERROR_PROCESAMIENTO') return;
  await db.movimiento.update({
    where: { id: mov.id },
    data: { estado: 'ERROR_PROCESAMIENTO', flags: { ...(mov.flags as object | null ?? {}), errorProcesamiento: error } as never },
  });
  await writeAudit(db, {
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'ERROR_PROCESAMIENTO',
    despues: { error },
  });
}

/**
 * Resolves who is recorded as creator for channel-ingested files (email or
 * telegram have no logged-in user): the member matching the sender email when
 * possible, otherwise the company's first administrator.
 */
export async function resolverCreadorCanal(empresaId: string, emailRemitente?: string | null): Promise<string | null> {
  if (emailRemitente) {
    const porEmail = await prisma.usuarioEmpresa.findFirst({
      where: { empresaId, usuario: { email: emailRemitente.toLowerCase().trim() } },
    });
    if (porEmail) return porEmail.usuarioId;
  }
  const admin = await prisma.usuarioEmpresa.findFirst({
    where: { empresaId, rol: 'ADMINISTRADOR' },
    orderBy: { id: 'asc' },
  });
  return admin?.usuarioId ?? null;
}
