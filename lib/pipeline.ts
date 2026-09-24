import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { getExtractor } from '@/lib/extractor';
import { cruzarMovimientoConArca } from '@/lib/arca/mis-comprobantes/service';
import { evaluarCampos, buscarDuplicados, normalizarCuit } from '@/lib/checks';
import { assertTransicion } from '@/lib/movimientos/estados';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { writeAudit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { leerQrAfip } from '@/lib/extractor/qr';
import { evaluarAutovalidacion, decidirAutovalidacion } from '@/lib/autovalidacion';
import { decidirAltaContraparte, claveNombre } from '@/lib/contrapartes/alta-automatica';
import { elegirRegla, condicionesDeMatch, textoDeMatching, type CondicionRegla } from '@/lib/reglas/matching';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { tieneAsignacionCompleta } from '@/lib/movimientos/service';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';
import type { EstadoMovimiento } from '@prisma/client';
import { vencimientoPagoDesdeTexto } from '@/lib/cobranzas/vencimiento';

// The single ingestion pipeline shared by ALL channels (web, photo, email,
// telegram): store immutable file -> Movimiento INGRESADO -> Job EXTRACCION ->
// worker extracts -> deterministic checks -> contraparte matching -> ARCA ->
// PENDIENTE_VALIDACION (or RETENIDO if the accrual period is closed).

/** Determina si un comprobante es una compra (emisor tercero) o una venta
 *  emitida por la propia empresa (emisor === CUIT de la empresa).
 *
 *  El CUIT emisor manda, pero con contra-señales: el OCR a veces toma el CUIT
 *  del recuadro del cliente como si fuera del emisor, y eso armaría una "venta"
 *  en la que la empresa se factura a sí misma. Si el receptor parece ser la
 *  propia empresa, es una COMPRA (nadie se factura a sí mismo); si solo la
 *  razón social emisora contradice al CUIT, queda VENTA pero marcada dudosa
 *  para que el validador la mire (con QR legible esto no pasa: el CUIT emisor
 *  sale del QR, que es autoritativo). */
export function clasificarDireccion(e: {
  cuitEmisor: string | null;
  cuitReceptor: string | null;
  cuitEmpresa: string | null;
  razonSocialEmisor?: string | null;
  razonSocialReceptor?: string | null;
  razonSocialEmpresa?: string | null;
}): { direccion: 'COMPRA' | 'VENTA'; dudosa: boolean } {
  if (!(e.cuitEmisor && e.cuitEmpresa && e.cuitEmisor === e.cuitEmpresa)) {
    return { direccion: 'COMPRA', dudosa: false };
  }
  const claveEmpresa = claveNombre(e.razonSocialEmpresa ?? null);
  const receptorEsLaEmpresa =
    (e.cuitReceptor != null && e.cuitReceptor === e.cuitEmpresa) ||
    (claveEmpresa != null && claveNombre(e.razonSocialReceptor ?? null) === claveEmpresa);
  if (receptorEsLaEmpresa) return { direccion: 'COMPRA', dudosa: true };

  const claveEmisor = claveNombre(e.razonSocialEmisor ?? null);
  const emisorContradice = claveEmisor != null && claveEmpresa != null && claveEmisor !== claveEmpresa;
  return { direccion: 'VENTA', dudosa: emisorContradice };
}

export type CanalIngreso = 'WEB' | 'FOTO' | 'EMAIL' | 'TELEGRAM' | 'MANUAL';

export async function ingestarComprobante(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
  canal: CanalIngreso;
  /** Lote de ingesta al que pertenece (un drop web / un mail / un mensaje). */
  loteId?: string | null;
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
      loteId: params.loteId ?? null,
    } as never,
  });

  await writeAudit(db, {
    usuarioId: params.usuarioId,
    entidad: 'Movimiento',
    entidadId: movimiento.id,
    accion: 'CREAR',
    despues: { origen: 'COMPROBANTE', canal: params.canal, archivo: params.filename, hash },
  });

  // Duplicado a nivel ARCHIVO: si la empresa ya tiene el MISMO archivo (hash),
  // va directo a DUPLICADO sin encolar extracción — es byte a byte el mismo
  // documento, re-extraerlo solo gasta tokens. Se excluyen ANULADO y
  // ERROR_PROCESAMIENTO para que re-subir tras anular o tras un error se
  // procese normal. La sugerencia de posible duplicado por valores
  // (CUIT+tipo+PV+nº) sigue intacta en la extracción para archivos distintos.
  const mismoArchivo = await db.movimiento.findFirst({
    where: {
      archivoHash: hash,
      id: { not: movimiento.id },
      estado: { notIn: ['ANULADO', 'ERROR_PROCESAMIENTO'] },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (mismoArchivo) {
    assertTransicion('INGRESADO', 'DUPLICADO');
    await db.movimiento.update({
      where: { id: movimiento.id },
      data: {
        estado: 'DUPLICADO',
        flags: { duplicadoArchivo: mismoArchivo.id, notaDuplicado: 'Archivo duplicado' } as never,
      },
    });
    await writeAudit(db, {
      usuarioId: params.usuarioId,
      entidad: 'Movimiento',
      entidadId: movimiento.id,
      accion: 'AUTO_DUPLICADO',
      despues: { estado: 'DUPLICADO', duplicados: [mismoArchivo.id], confirmadoPor: 'HASH_ARCHIVO', archivo: params.filename },
    });
    return { movimientoId: movimiento.id };
  }

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

  const { extraccion, uso } = await getExtractor().extract({
    buffer,
    mime: mov.archivoMime ?? 'application/pdf',
    filename: mov.archivoNombre ?? 'comprobante',
    instrucciones,
  });

  const camposRevisar = evaluarCampos(extraccion);

  // El QR de ARCA/AFIP es la fuente AUTORITATIVA del encabezado cuando existe (trae
  // emisor, receptor, importe, PV, nro y CAE). El LLM queda como fallback y para lo
  // que el QR no trae (líneas, desglose de IVA). Best-effort: no bloquea si falta.
  const resultadoQr = mov.archivoMime === 'application/pdf' ? await leerQrAfip(buffer) : null;
  const qrAfip = resultadoQr?.qr ?? null;
  const qrEstado = resultadoQr?.estado ?? null; // null = no aplica (imagen / no PDF)

  // Empresa no es un modelo scoped por empresa (ver SCOPED_MODELS en lib/empresa/scope.ts)
  // y el lookup es por su propia PK (el id del tenant, seteado server-side): no hay riesgo
  // cross-tenant. Usamos el cliente global `prisma`, igual que el resto de pipeline.ts.
  const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId } });
  const cuitEmpresa = empresa?.cuit ? normalizarCuit(empresa.cuit) : null;

  // Campos de encabezado: QR manda; si no hay QR, el LLM.
  const cuit = qrAfip ? String(qrAfip.cuit) : extraccion.cuitEmisor ? normalizarCuit(extraccion.cuitEmisor) : null;
  const cuitReceptor =
    qrAfip && qrAfip.tipoDocRec === 80 && qrAfip.nroDocRec
      ? String(qrAfip.nroDocRec)
      : extraccion.cuitReceptor
        ? normalizarCuit(extraccion.cuitReceptor)
        : null;
  const totalFinal = qrAfip ? qrAfip.importe : extraccion.total;
  const caeFinal = qrAfip ? String(qrAfip.codAut) : extraccion.cae;
  const puntoVentaFinal = qrAfip ? String(qrAfip.ptoVta).padStart(5, '0') : extraccion.puntoVenta;
  // Moneda y tipo de cambio: el QR es autoritativo (trae moneda y ctz oficial).
  // Sin QR, la moneda queda la del LLM y el TC lo pide la validación.
  const MONEDA_QR: Record<string, 'ARS' | 'USD' | 'EUR'> = { PES: 'ARS', DOL: 'USD', '060': 'EUR' };
  const monedaFinal = qrAfip?.moneda ? (MONEDA_QR[qrAfip.moneda] ?? 'OTRA') : extraccion.moneda;
  const tipoCambioFinal =
    monedaFinal !== 'ARS' && qrAfip && qrAfip.ctz > 0 ? qrAfip.ctz : null;
  const numeroFinal = qrAfip ? String(qrAfip.nroCmp).padStart(8, '0') : extraccion.numero;

  const clasificacion = clasificarDireccion({
    cuitEmisor: cuit,
    cuitReceptor,
    cuitEmpresa,
    razonSocialEmisor: extraccion.razonSocialEmisor,
    razonSocialReceptor: extraccion.razonSocialReceptor,
    razonSocialEmpresa: empresa?.razonSocial ?? null,
  });
  const direccion = clasificacion.direccion;
  if (clasificacion.dudosa) {
    camposRevisar.direccion =
      direccion === 'COMPRA'
        ? 'El CUIT emisor extraído era el de la propia empresa pero las razones sociales dicen que es una compra (probable CUIT del recuadro del cliente): revisá compra/venta y el CUIT del emisor'
        : 'El CUIT emisor es el de la empresa pero la razón social emisora extraída es de un tercero: revisá compra/venta';
  }
  const origenFinal: 'COMPROBANTE' | 'VENTA_COMPROBANTE' =
    direccion === 'VENTA' ? 'VENTA_COMPROBANTE' : 'COMPROBANTE';

  // En ventas, la contraparte es el RECEPTOR (cliente); en compras, el EMISOR (proveedor).
  const cuitContraparte = direccion === 'VENTA' ? cuitReceptor : cuit;
  // ¿Ese CUIT lo aportó el QR? Es la condición para dar de alta la contraparte
  // sola: el QR es la única fuente autoritativa de identidad hasta que entre ARCA.
  const cuitContraparteDesdeQr =
    direccion === 'VENTA'
      ? Boolean(qrAfip && qrAfip.tipoDocRec === 80 && qrAfip.nroDocRec)
      : Boolean(qrAfip);

  let contraparte = cuitContraparte
    ? await db.contraparte.findFirst({ where: { cuit: cuitContraparte, activa: true } })
    : null;

  // El CUIT es único por empresa, así que una contraparte DESACTIVADA igual ocupa
  // el lugar: no se da de alta de nuevo (chocaría contra la unicidad) ni se
  // vincula sola — alguien la desactivó a propósito. Queda para la validación.
  const ocupadoPorInactiva =
    !contraparte && cuitContraparte
      ? (await db.contraparte.count({ where: { cuit: cuitContraparte } })) > 0
      : false;

  const alta = decidirAltaContraparte({
    direccion,
    cuitContraparte,
    cuitDesdeQr: cuitContraparteDesdeQr,
    razonSocialEmisor: extraccion.razonSocialEmisor,
    razonSocialReceptor: extraccion.razonSocialReceptor,
    yaExiste: contraparte != null || ocupadoPorInactiva,
    razonSocialEmpresa: empresa?.razonSocial ?? null,
    cuitEmpresa,
  });

  if (cuitContraparte && !contraparte) {
    if (alta.crear) {
      try {
        contraparte = await db.contraparte.create({
          data: { cuit: alta.cuit, razonSocial: alta.razonSocial, tipo: alta.tipo } as never,
        });
        await writeAudit(db, {
          entidad: 'Contraparte',
          entidadId: contraparte.id,
          accion: 'CREAR',
          despues: { cuit: alta.cuit, razonSocial: alta.razonSocial, tipo: alta.tipo, desdeQr: true },
        });
      } catch {
        // Unicidad (empresaId, cuit): otro comprobante del mismo emisor la creó
        // primero en paralelo. Reusamos la que ganó.
        contraparte = await db.contraparte.findFirst({ where: { cuit: cuitContraparte, activa: true } });
      }
    }
    camposRevisar.contraparte = contraparte
      ? 'Contraparte dada de alta desde el QR: revisá la razón social'
      : 'Contraparte nueva: no está en el maestro';
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
      puntoVenta: puntoVentaFinal,
      numero: numeroFinal,
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
  const flags: Record<string, unknown> = { ...(mov.flags as object | null ?? {}) };
  if (duplicados.length) flags.duplicados = duplicados.map((d) => d.id);

  // --- Preasignación por reglas + autovalidación (QR + aritmética) ---
  // Las reglas se evalúan SIEMPRE (período abierto), no solo cuando autovalida:
  // así un comprobante que queda PENDIENTE igual llega a la cola de Validación
  // con su preasignación ya cargada (regla > defaults de contraparte). La
  // autovalidación decide el estado: apto+completa→ASIGNADO, apto→VALIDADO,
  // no apto→PENDIENTE_VALIDACION; período cerrado nunca autovalida.
  const n = (v: unknown) => (v == null ? null : Number(v));
  // Descripción = concepto extraído (lo facturado), truncado: el LLM puede
  // devolver un detalle largo. Ya no sintetizamos el genérico "Comprobante de X".
  const conceptoLimpio = extraccion.concepto?.trim() || null;
  const descripcionFinal = conceptoLimpio
    ? conceptoLimpio.length > 280 ? `${conceptoLimpio.slice(0, 280)}…` : conceptoLimpio
    : mov.descripcion;
  let lineasContraparte: LineaDistribucion[] = [];
  if (contraparte?.distribucionDefaultId) {
    const plantilla = await db.plantillaDistribucion.findFirst({
      where: { id: contraparte.distribucionDefaultId },
      include: { lineas: true },
    });
    if (plantilla) {
      lineasContraparte = plantilla.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
    }
  }
  let categoriaEfectiva: string | null = contraparte?.categoriaDefaultId ?? null;
  let lineasEfectivas: LineaDistribucion[] = lineasContraparte;
  // Para el historial: no alcanza con el nombre de la regla, se registra POR QUÉ
  // matcheó (condiciones) y qué imputación resolvió.
  type ReglaInfo = { id: string; nombre: string; condiciones: CondicionRegla[]; categoriaId?: string | null };
  let reglaAplicada: ReglaInfo | null = null;
  const auto = evaluarAutovalidacion({
    qrEstado,
    esComprobanteFiscalArg: !!extraccion.esComprobanteFiscalArg,
    cae: caeFinal,
    qrAporto: qrAfip != null,
    importes: {
      netoGravado: n(extraccion.netoGravado),
      iva21: n(extraccion.iva21),
      iva105: n(extraccion.iva105),
      iva27: n(extraccion.iva27),
      percepcionesIva: n(extraccion.percepcionesIva),
      percepcionesIibb: n(extraccion.percepcionesIibb),
      otrosTributos: n(extraccion.otrosTributos),
      noGravadoExento: n(extraccion.noGravadoExento),
    },
    total: totalFinal != null ? Number(totalFinal) : null,
    hayDuplicados: duplicados.length > 0,
    moneda: monedaFinal,
    tipoCambio: tipoCambioFinal,
    tieneContraparte: contraparte != null,
  });
  let observarPorRegla: ReglaInfo | null = null;
  if (estadoFinal !== 'RETENIDO') {
    const reglas = await db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] });
    const regla = elegirRegla(reglas, {
      creadoPorId: mov.creadoPorId,
      // La contraparte, no el emisor: en ventas el emisor es siempre la propia
      // empresa y una regla por CUIT matchearía TODAS las ventas.
      cuitContraparte,
      canalIngreso: mov.canalIngreso,
      texto: textoDeMatching({
        razonSocial: direccion === 'VENTA' ? extraccion.razonSocialReceptor : extraccion.razonSocialEmisor,
        descripcion: descripcionFinal,
        textoDocumento: extraccion.textoDocumento,
      }),
    });
    if (regla?.accion === 'OBSERVAR') {
      // descarte automático
      observarPorRegla = { id: regla.id, nombre: regla.nombre, condiciones: condicionesDeMatch(regla) };
    } else if (regla) {
      const asign = await resolverAsignacionDeRegla(db, regla);
      categoriaEfectiva = asign.categoriaId;
      lineasEfectivas = asign.lineas;
      reglaAplicada = { id: regla.id, nombre: regla.nombre, condiciones: condicionesDeMatch(regla), categoriaId: asign.categoriaId };
      flags.reglaPreasignacion = regla.nombre; // marcador para la vista de Validación
    }
  }

  // Duplicado confirmado: el QR aporta la identidad autoritativa (cuit/pv/nro);
  // si además hay un duplicado, lo apartamos a DUPLICADO automáticamente.
  const duplicadoConfirmado = duplicados.length > 0 && qrEstado === 'OK';

  const completa = tieneAsignacionCompleta(categoriaEfectiva, lineasEfectivas);
  let estadoFinalReal: EstadoMovimiento;
  if (duplicadoConfirmado) {
    estadoFinalReal = 'DUPLICADO';
  } else if (observarPorRegla) {
    estadoFinalReal = 'OBSERVADO';
    flags.notaObservacion = `Observado automáticamente por la regla «${observarPorRegla.nombre}»`;
    flags.observadoPorRegla = observarPorRegla.nombre;
  } else {
    estadoFinalReal = decidirAutovalidacion({ apto: auto.apto, completa, estadoBase: estadoFinal });
  }
  assertTransicion('PROCESANDO', estadoFinalReal);

  await db.movimiento.update({
    where: { id: mov.id },
    data: {
      estado: estadoFinalReal,
      fechaDevengamiento,
      periodoId,
      cuitEmisor: cuit,
      contraparteId: contraparte?.id ?? null,
      categoriaId: categoriaEfectiva,
      descripcion: descripcionFinal,
      moneda: monedaFinal,
      tipoCambio: tipoCambioFinal,
      tipoComprobante: extraccion.tipoComprobante,
      puntoVenta: puntoVentaFinal,
      numero: numeroFinal,
      cae: caeFinal,
      vencimientoCae: extraccion.vencimientoCae ? new Date(`${extraccion.vencimientoCae}T00:00:00Z`) : null,
      // Vencimiento de pago: el del LLM; si no lo dio, el del texto del documento.
      fechaVencimientoPago: (() => {
        const iso = extraccion.fechaVencimientoPago ?? vencimientoPagoDesdeTexto(extraccion.textoDocumento);
        return iso ? new Date(`${iso}T00:00:00Z`) : null;
      })(),
      netoGravado: extraccion.netoGravado,
      iva21: extraccion.iva21,
      iva105: extraccion.iva105,
      iva27: extraccion.iva27,
      percepcionesIva: extraccion.percepcionesIva,
      percepcionesIibb: extraccion.percepcionesIibb,
      otrosTributos: extraccion.otrosTributos,
      noGravadoExento: extraccion.noGravadoExento,
      total: totalFinal,
      origen: origenFinal,
      tokensEntrada: uso?.entrada ?? null,
      tokensSalida: uso?.salida ?? null,
      tokensCacheCreacion: uso?.cacheCreacion ?? null,
      tokensCacheLectura: uso?.cacheLectura ?? null,
      modeloExtractor: uso?.modelo ?? null,
      qrEstado,
      extraccionRaw: { ...extraccion, cuitReceptorEfectivo: cuitReceptor, qrAfip } as never,
      camposRevisar: camposRevisar as never,
      confianza: (extraccion.confianza ?? {}) as never,
      flags: flags as never,
    },
  });

  // Persistir las líneas efectivas (regla > contraparte). Reemplaza preexistentes.
  if (lineasEfectivas.length) {
    await prisma.movimientoLinea.deleteMany({ where: { movimientoId: mov.id } });
    await prisma.movimientoLinea.createMany({
      data: lineasEfectivas.map((l) => ({
        movimientoId: mov.id,
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: l.porcentaje,
      })),
    });
  }

  await writeAudit(db, {
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'EXTRAER',
    despues: {
      estado: estadoFinalReal,
      camposRevisar,
      duplicados: duplicados.map((d) => d.id),
      contraparte: contraparte?.razonSocial ?? null,
      // Resultado de la autovalidación aunque NO haya validado: antes los
      // motivos del rechazo se perdían y el historial no podía explicarlo.
      autovalidacion: { apto: auto.apto, motivos: auto.motivos, aprobados: auto.aprobados },
    },
  });

  // Acción del sistema (sin usuarioId): autovalidación / auto-asignación / descarte / duplicado.
  if (estadoFinalReal === 'VALIDADO' || estadoFinalReal === 'ASIGNADO') {
    await writeAudit(db, {
      entidad: 'Movimiento',
      entidadId: mov.id,
      accion: estadoFinalReal === 'ASIGNADO' ? 'AUTO_ASIGNAR' : 'AUTO_VALIDAR',
      despues: { estado: estadoFinalReal, regla: reglaAplicada, chequeos: auto.aprobados, lineas: lineasEfectivas },
    });
  } else if (estadoFinalReal === 'DUPLICADO') {
    await writeAudit(db, {
      entidad: 'Movimiento',
      entidadId: mov.id,
      accion: 'AUTO_DUPLICADO',
      despues: { estado: 'DUPLICADO', duplicados: duplicados.map((d) => d.id), confirmadoPor: 'QR' },
    });
  } else if (estadoFinalReal === 'OBSERVADO' && observarPorRegla) {
    await writeAudit(db, {
      entidad: 'Movimiento',
      entidadId: mov.id,
      accion: 'AUTO_OBSERVAR',
      despues: { estado: 'OBSERVADO', regla: observarPorRegla },
    });
  }

  // El tag ARCA sale sólo del cruce con Mis Comprobantes: se intenta apenas hay
  // con qué cruzar (CAE, o CUIT emisor + punto de venta + número). Sin eso queda
  // NO_VERIFICADO y la validación exige overrideNoFiscal.
  if (extraccion.cae || (extraccion.cuitEmisor && extraccion.puntoVenta && extraccion.numero)) {
    await enqueueJob('ARCA', { movimientoId: mov.id, empresaId: payload.empresaId }, payload.empresaId);
  }
}

/**
 * Job ARCA: cruza el comprobante con lo bajado de Mis Comprobantes, la única
 * fuente del tag "ARCA válido". Si no figura (todavía), no cambia nada: la
 * próxima sync diaria vuelve a intentar con lo que baje.
 */
export async function procesarArca(payload: { movimientoId: string; empresaId: string }): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId }, select: { id: true, cuit: true } });
  if (!empresa) throw new Error(`Empresa ${payload.empresaId} inexistente`);
  await cruzarMovimientoConArca(db, empresa, payload.movimientoId, null);
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
