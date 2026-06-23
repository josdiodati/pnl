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
