import { describe, it, expect } from 'vitest';
import { netoDe, netoFirmadoDe, textoNetoTotal } from '@/lib/movimientos/neto';

// El "Neto" único de todas las vistas: total − IVA − percepciones − otros
// tributos (la base imponible del P&L).

describe('netoDe', () => {
  it('descuenta IVA, percepciones y otros tributos', () => {
    expect(netoDe({ total: 1210, iva21: 210 })).toBe(1000);
    expect(netoDe({ total: 1500, iva21: 210, iva105: 50, percepcionesIva: 30, percepcionesIibb: 20, otrosTributos: 190 })).toBe(1000);
  });
  it('sin desglose (factura C, exento) el neto es el total; sin total, null', () => {
    expect(netoDe({ total: 800 })).toBe(800);
    expect(netoDe({})).toBeNull();
  });
});

describe('netoFirmadoDe', () => {
  it('mantiene el signo y la pesificación del total firmado', () => {
    expect(netoFirmadoDe(-121000, { total: 1210, iva21: 210 })).toBe(-100000);
    expect(netoFirmadoDe(121000 * 1000, { total: 1210, iva21: 210 })).toBe(100000 * 1000); // USD × TC 1000
    expect(netoFirmadoDe(null, { total: 1210 })).toBeNull();
  });
});

describe('textoNetoTotal', () => {
  it('muestra neto y total, con la moneda si no es ARS', () => {
    expect(textoNetoTotal({ total: 1210, iva21: 210 })).toMatch(/^neto .*1\.000,00 · total .*1\.210,00$/);
    expect(textoNetoTotal({ total: 121, iva21: 21, moneda: 'USD' })).toMatch(/USD · total .*USD$/);
    expect(textoNetoTotal({})).toBe('sin total');
  });
});
