import type { Extraccion } from '@/lib/extractor/schema';
import { mensajeAritmetica } from './aritmetica';
import { cuitEsValido } from './cuit';
import { checkFecha } from './fecha';

export { cuitEsValido, normalizarCuit, formatearCuit } from './cuit';
export { checkAritmetica, mensajeAritmetica, parseImporte, TOLERANCIA_CENTAVOS, aCentavos } from './aritmetica';
export { checkFecha } from './fecha';
export { buscarDuplicados, esMismaClave } from './duplicados';

const UMBRAL_CONFIANZA = 0.7;

/**
 * Deterministic field-level checks over an extraction. Each flagged field maps
 * to a human-readable reason. They only color/alert the validation screen; a
 * movement is never auto-validated nor auto-rejected by these.
 */
export function evaluarCampos(extraccion: Extraccion): Record<string, string> {
  const revisar: Record<string, string> = {};

  // Required-for-accrual fields missing entirely
  if (extraccion.total == null) revisar.total = 'No se pudo extraer el total';
  if (!extraccion.fechaEmision) revisar.fechaEmision = 'No se pudo extraer la fecha';
  if (!extraccion.cuitEmisor) revisar.cuitEmisor = 'No se pudo extraer el CUIT del emisor';

  // CUIT check digit
  if (extraccion.cuitEmisor && !cuitEsValido(extraccion.cuitEmisor)) {
    revisar.cuitEmisor = 'CUIT con dígito verificador inválido';
  }

  // Arithmetic: components must sum the total (±$1)
  const desvio = mensajeAritmetica(extraccion);
  if (desvio) revisar.total = desvio;

  // Date sanity
  if (extraccion.fechaEmision) {
    const f = checkFecha(extraccion.fechaEmision);
    if (!f.ok) revisar.fechaEmision = f.motivo ?? 'Fecha sospechosa';
  }

  // Soft alert: factura A without discriminated VAT
  if (
    extraccion.tipoComprobante === 'FACTURA_A' &&
    !extraccion.iva21 && !extraccion.iva105 && !extraccion.iva27
  ) {
    revisar.iva21 = 'Factura A sin IVA discriminado';
  }

  // Low per-field confidence reported by the extractor
  for (const [campo, conf] of Object.entries(extraccion.confianza ?? {})) {
    if (conf < UMBRAL_CONFIANZA && !revisar[campo]) {
      revisar[campo] = `Confianza baja del OCR (${Math.round(conf * 100)}%)`;
    }
  }

  return revisar;
}
