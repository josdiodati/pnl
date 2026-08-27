import { describe, it, expect } from 'vitest';
import { resumenExtraccionSchema } from '@/lib/extractor/resumen-schema';

describe('resumenExtraccionSchema', () => {
  it('parsea un resumen de tarjeta con línea USD sin pesificar y titular', () => {
    const r = resumenExtraccionSchema.parse({
      tipo: 'TARJETA',
      emisor: 'Visa Business BBVA',
      periodoAnio: 2026,
      periodoMes: 7,
      fechaCierre: '2026-07-30',
      totalDeclarado: -1376102.08,
      lineas: [
        { fecha: '2026-06-29', descriptor: 'ANTHROPIC* CLAUD', monto: null, moneda: 'USD', montoOrigen: -100, cuenta: null, titular: 'JACINTO DIODATI', cuotas: null },
        { fecha: '2026-07-29', descriptor: 'COMISION MANT. DE CUENTA', monto: -7128.1, moneda: 'ARS', montoOrigen: null, cuenta: null, titular: null, cuotas: null },
      ],
    });
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[0].monto).toBeNull();
    expect(r.lineas[0].montoOrigen).toBe(-100);
  });

  it('parsea un resumen de banco multi-cuenta y una línea positiva (crédito)', () => {
    const r = resumenExtraccionSchema.parse({
      tipo: 'BANCO',
      emisor: 'Mercado Pago',
      periodoAnio: 2026,
      periodoMes: 7,
      lineas: [
        { fecha: '2026-07-01', descriptor: 'Rendimientos', monto: 153.89, moneda: 'ARS', montoOrigen: null, cuenta: 'CVU 0000003100092554367658', titular: null, cuotas: null },
      ],
    });
    expect(r.lineas[0].monto).toBeGreaterThan(0);
    expect(r.totalDeclarado).toBeNull();
  });

  it('un resumen sin movimientos parsea con 0 líneas', () => {
    const r = resumenExtraccionSchema.parse({ tipo: 'BANCO', emisor: 'Santander U$S', periodoAnio: 2026, periodoMes: 7 });
    expect(r.lineas).toEqual([]);
  });

  it('rechaza mes inválido y tipo desconocido', () => {
    expect(() => resumenExtraccionSchema.parse({ tipo: 'OTRO', emisor: 'x', periodoAnio: 2026, periodoMes: 7 })).toThrow();
    expect(() => resumenExtraccionSchema.parse({ tipo: 'BANCO', emisor: 'x', periodoAnio: 2026, periodoMes: 13 })).toThrow();
  });
});
