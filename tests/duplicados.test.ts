import { describe, it, expect } from 'vitest';
import { esMismaClave } from '@/lib/checks/duplicados';

describe('detección de duplicados: cuit + tipo + punto de venta + número', () => {
  const base = {
    cuitEmisor: '30714325651',
    tipoComprobante: 'FACTURA_A',
    puntoVenta: '0001',
    numero: '00001234',
  };

  it('detecta clave idéntica', () => {
    expect(esMismaClave(base, { ...base })).toBe(true);
  });

  it('ignora ceros a la izquierda y mayúsculas', () => {
    expect(esMismaClave(base, { ...base, puntoVenta: '1', numero: '1234' })).toBe(true);
    expect(esMismaClave(base, { ...base, tipoComprobante: 'factura_a' })).toBe(true);
  });

  it('distinto número/PV/tipo/cuit NO es duplicado', () => {
    expect(esMismaClave(base, { ...base, numero: '00001235' })).toBe(false);
    expect(esMismaClave(base, { ...base, puntoVenta: '0002' })).toBe(false);
    expect(esMismaClave(base, { ...base, tipoComprobante: 'FACTURA_B' })).toBe(false);
    expect(esMismaClave(base, { ...base, cuitEmisor: '20128364847' })).toBe(false);
  });

  it('clave incompleta nunca matchea (sin falsos positivos)', () => {
    expect(esMismaClave({ ...base, cuitEmisor: null }, base)).toBe(false);
    expect(esMismaClave({ ...base, numero: null }, base)).toBe(false);
    expect(esMismaClave({ ...base, tipoComprobante: null }, base)).toBe(false);
  });
});
