import { describe, it, expect } from 'vitest';
import { evaluarAutovalidacion, decidirAutovalidacion, type EntradaAutoval } from '@/lib/autovalidacion';

const ok: EntradaAutoval = {
  qrEstado: 'OK', esComprobanteFiscalArg: true, cae: '74100000000000', qrAporto: true,
  importes: { netoGravado: 100, iva21: 21 }, total: 121, hayDuplicados: false,
};

describe('evaluarAutovalidacion', () => {
  it('caso feliz', () => { expect(evaluarAutovalidacion(ok).apto).toBe(true); });
  it('QR no OK → no apto', () => { expect(evaluarAutovalidacion({ ...ok, qrEstado: 'ILEGIBLE' }).apto).toBe(false); });
  it('no fiscal → no apto', () => { expect(evaluarAutovalidacion({ ...ok, esComprobanteFiscalArg: false }).apto).toBe(false); });
  it('sin CAE → no apto', () => { expect(evaluarAutovalidacion({ ...ok, cae: null }).apto).toBe(false); });
  it('QR no aportó → no apto', () => { expect(evaluarAutovalidacion({ ...ok, qrAporto: false }).apto).toBe(false); });
  it('duplicado → no apto', () => { expect(evaluarAutovalidacion({ ...ok, hayDuplicados: true }).apto).toBe(false); });
  it('aritmética fuera de tolerancia → no apto', () => {
    expect(evaluarAutovalidacion({ ...ok, total: 200 }).apto).toBe(false);
  });
  it('aritmética dentro de tolerancia ($1) → apto', () => {
    expect(evaluarAutovalidacion({ ...ok, total: 121.5 }).apto).toBe(true);
  });
  it('sin total → no apto', () => { expect(evaluarAutovalidacion({ ...ok, total: null }).apto).toBe(false); });
  it('sin contraparte en el maestro → no apto (queda para que el validador la cree)', () => {
    const r = evaluarAutovalidacion({ ...ok, tieneContraparte: false });
    expect(r.apto).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/contraparte/);
  });
  it('con contraparte vinculada → apto', () => {
    expect(evaluarAutovalidacion({ ...ok, tieneContraparte: true }).apto).toBe(true);
  });
});

describe('evaluarAutovalidacion — chequeos aprobados (para el historial)', () => {
  it('caso feliz: informa todos los chequeos que pasaron', () => {
    const r = evaluarAutovalidacion(ok);
    expect(r.aprobados).toEqual([
      'QR legible',
      'comprobante fiscal argentino',
      'CAE presente',
      'encabezado tomado del QR',
      'sin duplicados',
      'la aritmética cuadra',
    ]);
  });
  it('un chequeo que falla no aparece entre los aprobados', () => {
    const r = evaluarAutovalidacion({ ...ok, cae: null, hayDuplicados: true });
    expect(r.aprobados).not.toContain('CAE presente');
    expect(r.aprobados).not.toContain('sin duplicados');
    expect(r.aprobados).toContain('QR legible');
    expect(r.motivos).toEqual(['sin CAE', 'posible duplicado']);
  });
  it('moneda extranjera con TC aprueba el chequeo de moneda', () => {
    const r = evaluarAutovalidacion({ ...ok, moneda: 'USD', tipoCambio: 1000 });
    expect(r.aprobados).toContain('tipo de cambio presente');
  });
  it('contraparte vinculada aprueba el chequeo de contraparte', () => {
    const r = evaluarAutovalidacion({ ...ok, tieneContraparte: true });
    expect(r.aprobados).toContain('contraparte en el maestro');
  });
  it('sin total: la aritmética no aparece ni aprobada ni con doble motivo', () => {
    const r = evaluarAutovalidacion({ ...ok, total: null });
    expect(r.aprobados).not.toContain('la aritmética cuadra');
    expect(r.motivos).toContain('sin total');
  });
});

describe('decidirAutovalidacion', () => {
  it('período cerrado → RETENIDO siempre', () => {
    expect(decidirAutovalidacion({ apto: true, completa: true, estadoBase: 'RETENIDO' })).toBe('RETENIDO');
  });
  it('no apto → PENDIENTE_VALIDACION', () => {
    expect(decidirAutovalidacion({ apto: false, completa: false, estadoBase: 'PENDIENTE_VALIDACION' })).toBe('PENDIENTE_VALIDACION');
  });
  it('apto + completa → ASIGNADO', () => {
    expect(decidirAutovalidacion({ apto: true, completa: true, estadoBase: 'PENDIENTE_VALIDACION' })).toBe('ASIGNADO');
  });
  it('apto + incompleta → VALIDADO', () => {
    expect(decidirAutovalidacion({ apto: true, completa: false, estadoBase: 'PENDIENTE_VALIDACION' })).toBe('VALIDADO');
  });
});
