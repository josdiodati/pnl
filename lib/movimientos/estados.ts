import type { EstadoMovimiento, OrigenMovimiento } from '@prisma/client';
import { DomainError } from '@/lib/errors';

// State machine (doc 07):
//
// INGRESADO → PROCESANDO → PENDIENTE_VALIDACION → VALIDADO
//                               ↘ RETENIDO (closed period)
//                               ↘ OBSERVADO (set aside)
// PENDIENTE_VALIDACION / OBSERVADO / RETENIDO → VALIDADO
// VALIDADO → ANULADO (reason required)
// PROCESANDO → ERROR_PROCESAMIENTO (OCR failed; retry or manual entry)
//
// Pending/observed/retained movements can also be voided (closing a month
// requires resolving them by validating OR voiding). Nothing is ever deleted.

const TRANSICIONES: Record<EstadoMovimiento, EstadoMovimiento[]> = {
  INGRESADO: ['PROCESANDO'],
  PROCESANDO: ['PENDIENTE_VALIDACION', 'RETENIDO', 'ERROR_PROCESAMIENTO'],
  PENDIENTE_VALIDACION: ['VALIDADO', 'OBSERVADO', 'RETENIDO', 'ANULADO'],
  OBSERVADO: ['VALIDADO', 'PENDIENTE_VALIDACION', 'ANULADO'],
  RETENIDO: ['VALIDADO', 'PENDIENTE_VALIDACION', 'ANULADO'],
  VALIDADO: ['ANULADO'],
  ANULADO: [],
  ERROR_PROCESAMIENTO: ['PROCESANDO', 'PENDIENTE_VALIDACION'],
};

// Valid initial states per origin: vouchers always enter the OCR pipeline;
// manual entries are born pending (or validated directly by a validator+).
const ESTADOS_INICIALES: Record<OrigenMovimiento, EstadoMovimiento[]> = {
  COMPROBANTE: ['INGRESADO'],
  VENTA_COMPROBANTE: ['INGRESADO'],
  ASIENTO_MANUAL: ['PENDIENTE_VALIDACION', 'VALIDADO'],
  VENTA_MANUAL: ['PENDIENTE_VALIDACION', 'VALIDADO'],
};

export function puedeTransicionar(desde: EstadoMovimiento, hacia: EstadoMovimiento): boolean {
  return TRANSICIONES[desde]?.includes(hacia) ?? false;
}

export function assertTransicion(desde: EstadoMovimiento, hacia: EstadoMovimiento): void {
  if (!puedeTransicionar(desde, hacia)) {
    throw new DomainError(`Transición de estado inválida: ${desde} → ${hacia}.`);
  }
}

export function esEstadoInicialValido(origen: OrigenMovimiento, estado: EstadoMovimiento): boolean {
  return ESTADOS_INICIALES[origen]?.includes(estado) ?? false;
}

/** Only VALIDADO hits the P&L / totals. */
export function impactaResultado(estado: EstadoMovimiento): boolean {
  return estado === 'VALIDADO';
}

export const ESTADO_LABEL: Record<EstadoMovimiento, string> = {
  INGRESADO: 'Ingresado',
  PROCESANDO: 'Procesando',
  PENDIENTE_VALIDACION: 'Pendiente de validación',
  RETENIDO: 'Retenido',
  OBSERVADO: 'Observado',
  VALIDADO: 'Validado',
  ANULADO: 'Anulado',
  ERROR_PROCESAMIENTO: 'Error de procesamiento',
};
