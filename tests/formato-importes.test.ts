import { describe, it, expect } from 'vitest';
import { parsearImporteAr } from '@/lib/format';

describe('parsearImporteAr', () => {
  it('interpreta un punto como separador decimal cuando no hay coma (round-trip del form de recibos)', () => {
    // El form de revisión de recibos precarga los totales con String(Number(valor)),
    // que produce decimales con punto (p.ej. "5993554.02"). Si el parser tratara
    // ese punto como separador de miles, un admin que confirma sin retocar el
    // campo multiplicaría el importe por 100.
    expect(parsearImporteAr('5993554.02')).toBe(5993554.02);
  });

  it('con coma, interpreta los puntos como separadores de miles y la coma como decimal', () => {
    expect(parsearImporteAr('1.234,56')).toBe(1234.56);
  });

  it('con coma pero sin puntos, interpreta la coma como separador decimal', () => {
    expect(parsearImporteAr('1234,56')).toBe(1234.56);
  });

  it('un número entero sin separadores se interpreta tal cual', () => {
    expect(parsearImporteAr('4770000')).toBe(4770000);
  });

  it('una cadena vacía (o sólo espacios) devuelve undefined', () => {
    expect(parsearImporteAr('')).toBeUndefined();
    expect(parsearImporteAr('   ')).toBeUndefined();
  });
});
