import { describe, it, expect } from 'vitest';
import {
  TIPOS_DOCUMENTO,
  descartarPorPrefiltro,
  descartarPorExtraccion,
  fechaBorradoNoComprobante,
  DIAS_RETENCION_NO_COMPROBANTE,
  UMBRAL_PREFILTRO,
} from '@/lib/carga/no-comprobante';

// Documentos que no son comprobantes (presupuestos, contratos, publicidad…):
// se apartan en NO_COMPROBANTE y se borran solos a los 7 días.

describe('no comprobantes', () => {
  it('COMPROBANTE es el primer tipo (el default)', () => {
    expect(TIPOS_DOCUMENTO[0]).toBe('COMPROBANTE');
  });

  it('prefiltro: descarta sólo si NO es comprobante y está seguro', () => {
    expect(descartarPorPrefiltro({ tipoDocumento: 'PUBLICIDAD', confianza: 0.95, motivo: 'newsletter' })).toBe(true);
    expect(descartarPorPrefiltro({ tipoDocumento: 'PUBLICIDAD', confianza: UMBRAL_PREFILTRO - 0.01, motivo: 'x' })).toBe(false);
    expect(descartarPorPrefiltro({ tipoDocumento: 'COMPROBANTE', confianza: 0.99, motivo: 'factura' })).toBe(false);
    expect(descartarPorPrefiltro(null)).toBe(false);
  });

  it('extracción: descarta si el modelo dice que no es comprobante, salvo QR de AFIP o datos de comprobante', () => {
    const nada = { cuitEmisor: null, total: null, numero: null };
    expect(descartarPorExtraccion('CONTRATO', false, nada)).toBe(true);
    expect(descartarPorExtraccion('CONTRATO', true, nada)).toBe(false);
    expect(descartarPorExtraccion('COMPROBANTE', false, nada)).toBe(false);
    // Una proforma o una liquidación con CUIT, total y número: mejor que lo mire una persona.
    expect(descartarPorExtraccion('PRESUPUESTO', false, { cuitEmisor: '30714325651', total: 1210, numero: '00001234' })).toBe(false);
    expect(descartarPorExtraccion('PRESUPUESTO', false, { cuitEmisor: '30714325651', total: 1210, numero: null })).toBe(true);
  });

  it('se borra a los 7 días', () => {
    expect(DIAS_RETENCION_NO_COMPROBANTE).toBe(7);
    expect(fechaBorradoNoComprobante(new Date('2026-09-29T12:00:00Z')).toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });
});
