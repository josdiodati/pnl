import { describe, it, expect } from 'vitest';
import { puedeTransicionar, assertTransicion, esEstadoInicialValido, impactaResultado, ESTADO_LABEL } from '@/lib/movimientos/estados';
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
    expect(puedeTransicionar('PROCESANDO', 'VALIDADO')).toBe(false);
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
});
