import { describe, it, expect } from 'vitest';
import { desglosarIvaIncluido } from '@/lib/movimientos/importes';

// Comprobantes B/tickets: el IVA viene incluido en el total sin discriminar.
// El desglose calcula neto = total / (1 + alícuota) al centavo, y el IVA es
// la diferencia exacta — así la aritmética (neto + iva = total) siempre cierra.

describe('desglosarIvaIncluido', () => {
  it('21%: neto + iva reconstruyen el total exacto', () => {
    const r = desglosarIvaIncluido(121000, 21);
    expect(r.neto).toBe(100000);
    expect(r.iva).toBe(21000);
  });

  it('10,5% con redondeo al centavo', () => {
    const r = desglosarIvaIncluido(11105.7, 10.5);
    expect(r.neto + r.iva).toBeCloseTo(11105.7, 2);
    expect(r.neto).toBeCloseTo(11105.7 / 1.105, 2);
  });

  it('27%', () => {
    const r = desglosarIvaIncluido(1270, 27);
    expect(r.neto).toBe(1000);
    expect(r.iva).toBe(270);
  });

  it('0% (exento): todo es neto', () => {
    expect(desglosarIvaIncluido(500, 0)).toEqual({ neto: 500, iva: 0 });
  });
});
