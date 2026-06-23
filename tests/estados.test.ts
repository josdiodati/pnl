import { describe, it, expect } from 'vitest';
import { puedeTransicionar, assertTransicion, esEstadoInicialValido, impactaResultado, ESTADO_LABEL, bloqueaCierre } from '@/lib/movimientos/estados';
import { DomainError } from '@/lib/errors';

describe('máquina de estados de movimientos (doc 07)', () => {
  it('camino feliz del pipeline', () => {
    expect(puedeTransicionar('INGRESADO', 'PROCESANDO')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'PENDIENTE_VALIDACION')).toBe(true);
    expect(puedeTransicionar('PENDIENTE_VALIDACION', 'VALIDADO')).toBe(true);
  });

  it('período cerrado y observación', () => {
    expect(puedeTransicionar('PROCESANDO', 'RETENIDO')).toBe(true);
    expect(puedeTransicionar('PENDIENTE_VALIDACION', 'OBSERVADO')).toBe(true);
    expect(puedeTransicionar('OBSERVADO', 'VALIDADO')).toBe(true);
    expect(puedeTransicionar('OBSERVADO', 'PENDIENTE_VALIDACION')).toBe(true);
    expect(puedeTransicionar('RETENIDO', 'VALIDADO')).toBe(true);
  });

  it('anulación: desde validado y desde estados resolubles, nunca desde anulado', () => {
    expect(puedeTransicionar('VALIDADO', 'ANULADO')).toBe(true);
    expect(puedeTransicionar('PENDIENTE_VALIDACION', 'ANULADO')).toBe(true);
    expect(puedeTransicionar('OBSERVADO', 'ANULADO')).toBe(true);
    expect(puedeTransicionar('RETENIDO', 'ANULADO')).toBe(true);
    expect(puedeTransicionar('ANULADO', 'VALIDADO')).toBe(false);
    expect(puedeTransicionar('ANULADO', 'PENDIENTE_VALIDACION')).toBe(false);
  });

  it('errores de procesamiento: reintentar o cargar a mano', () => {
    expect(puedeTransicionar('PROCESANDO', 'ERROR_PROCESAMIENTO')).toBe(true);
    expect(puedeTransicionar('ERROR_PROCESAMIENTO', 'PROCESANDO')).toBe(true);
    expect(puedeTransicionar('ERROR_PROCESAMIENTO', 'PENDIENTE_VALIDACION')).toBe(true);
  });

  it('rechaza transiciones ilegales', () => {
    expect(puedeTransicionar('INGRESADO', 'VALIDADO')).toBe(false);
    expect(puedeTransicionar('VALIDADO', 'PENDIENTE_VALIDACION')).toBe(false);
    // PROCESANDO→VALIDADO/ASIGNADO ahora SÍ es válido (autovalidación); usamos
    // una transición que sigue siendo ilegal para cubrir el rechazo.
    expect(puedeTransicionar('INGRESADO', 'ASIGNADO')).toBe(false);
    expect(() => assertTransicion('INGRESADO', 'VALIDADO')).toThrow(DomainError);
  });

  it('estados iniciales válidos por origen', () => {
    expect(esEstadoInicialValido('COMPROBANTE', 'INGRESADO')).toBe(true);
    expect(esEstadoInicialValido('COMPROBANTE', 'VALIDADO')).toBe(false);
    expect(esEstadoInicialValido('ASIENTO_MANUAL', 'PENDIENTE_VALIDACION')).toBe(true);
    expect(esEstadoInicialValido('ASIENTO_MANUAL', 'VALIDADO')).toBe(true);
    expect(esEstadoInicialValido('VENTA_MANUAL', 'INGRESADO')).toBe(false);
  });

  it('solo ASIGNADO impacta el resultado', () => {
    expect(impactaResultado('ASIGNADO')).toBe(true);
    for (const e of ['INGRESADO', 'PROCESANDO', 'PENDIENTE_VALIDACION', 'RETENIDO', 'OBSERVADO', 'VALIDADO', 'ANULADO', 'ERROR_PROCESAMIENTO'] as const) {
      expect(impactaResultado(e)).toBe(false);
    }
  });

  describe('salto directo a ASIGNADO al validar pre-asignados', () => {
    it('PENDIENTE_VALIDACION / OBSERVADO / RETENIDO pueden ir directo a ASIGNADO', () => {
      expect(puedeTransicionar('PENDIENTE_VALIDACION', 'ASIGNADO')).toBe(true);
      expect(puedeTransicionar('OBSERVADO', 'ASIGNADO')).toBe(true);
      expect(puedeTransicionar('RETENIDO', 'ASIGNADO')).toBe(true);
    });
  });

  describe('estado ASIGNADO', () => {
    it('VALIDADO puede pasar a ASIGNADO y a ANULADO', () => {
      expect(puedeTransicionar('VALIDADO', 'ASIGNADO')).toBe(true);
      expect(puedeTransicionar('VALIDADO', 'ANULADO')).toBe(true);
    });
    it('ASIGNADO puede des-asignarse (→VALIDADO) o anularse', () => {
      expect(puedeTransicionar('ASIGNADO', 'VALIDADO')).toBe(true);
      expect(puedeTransicionar('ASIGNADO', 'ANULADO')).toBe(true);
    });
    it('solo ASIGNADO impacta el resultado', () => {
      expect(impactaResultado('ASIGNADO')).toBe(true);
      expect(impactaResultado('VALIDADO')).toBe(false);
    });
    it('tiene label', () => {
      expect(ESTADO_LABEL.ASIGNADO).toBe('Asignado');
    });
  });

  describe('bloqueo de cierre', () => {
    it('VALIDADO sin asignar bloquea; ASIGNADO no', () => {
      expect(bloqueaCierre('VALIDADO')).toBe(true);
      expect(bloqueaCierre('ASIGNADO')).toBe(false);
      expect(bloqueaCierre('PENDIENTE_VALIDACION')).toBe(true);
      expect(bloqueaCierre('OBSERVADO')).toBe(true);
      expect(bloqueaCierre('RETENIDO')).toBe(true);
      expect(bloqueaCierre('ANULADO')).toBe(false);
    });
  });
});
