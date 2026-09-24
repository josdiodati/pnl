import { describe, it, expect } from 'vitest';
import { vencimientoPagoDesdeTexto } from '@/lib/cobranzas/vencimiento';

// Textos reales (compactados) de facturas emitidas con el facturador de ARCA:
// los rótulos van primero y los valores después, en el mismo orden.
const COMNET =
  'Fecha de Emisión: ORIGINAL EWWO CONSULTING S.R.L. Reconquista 1034 Piso:11 - Ciudad de Buenos Aires Período Facturado Desde: Hasta: Fecha de Vto. para el pago: CUIT: Condición de venta: Condición frente al IVA: Apellido y Nombre / Razón Social: Domicilio Comercial: 01/07/2026 31/07/2026 10/08/2026 31/07/2026 30712093486 30661571663 COMNET S A';
const LAROCCA =
  'Período Facturado Desde: Hasta: Fecha de Vto. para el pago: CUIT: Condición de venta: 01/08/2026 31/08/2026 30/08/2026 01/08/2026 30718332148';
const EXPORTACION =
  'Fecha de Emisión: ORIGINAL Señor(es): Domicilio: 19/08/2026 30712093486 Cubecorp Forma de Pago: Transferencia Incoterms: 19/08/2026Fecha de Pago: Auditoria';

describe('vencimientoPagoDesdeTexto', () => {
  it('toma la tercera fecha después de "Período Facturado Desde: Hasta: Fecha de Vto. para el pago:"', () => {
    expect(vencimientoPagoDesdeTexto(COMNET)).toBe('2026-08-10');
    expect(vencimientoPagoDesdeTexto(LAROCCA)).toBe('2026-08-30');
  });
  it('tolera saltos de línea y espacios múltiples', () => {
    expect(vencimientoPagoDesdeTexto(COMNET.replace(/ /g, '\n  '))).toBe('2026-08-10');
  });
  it('rótulo con la fecha a continuación (facturas sin período)', () => {
    expect(vencimientoPagoDesdeTexto('Fecha de Vto. para el pago: 15/09/2026 CUIT: 30712093486')).toBe('2026-09-15');
  });
  it('sin rótulo reconocible devuelve null (no adivina)', () => {
    expect(vencimientoPagoDesdeTexto(EXPORTACION)).toBeNull();
    expect(vencimientoPagoDesdeTexto(null)).toBeNull();
    expect(vencimientoPagoDesdeTexto('')).toBeNull();
  });
  it('descarta fechas inválidas', () => {
    expect(vencimientoPagoDesdeTexto('Fecha de Vto. para el pago: 31/02/2026')).toBeNull();
  });
});
