import { describe, it, expect } from 'vitest';
import { cuitEsValido, normalizarCuit, formatearCuit } from '@/lib/checks/cuit';

describe('CUIT: dígito verificador módulo 11', () => {
  it('acepta CUITs válidos conocidos', () => {
    // Verified against the standard mod-11 algorithm
    expect(cuitEsValido('30714325651')).toBe(true);
    expect(cuitEsValido('20128364847')).toBe(true);
    expect(cuitEsValido('30500010912')).toBe(true);
  });

  it('acepta CUIT con guiones y espacios', () => {
    expect(cuitEsValido('30-71432565-1')).toBe(true);
    expect(cuitEsValido(' 30 71432565 1 ')).toBe(true);
  });

  it('rechaza dígito verificador incorrecto', () => {
    expect(cuitEsValido('30714325650')).toBe(false);
    expect(cuitEsValido('20123456780')).toBe(false);
  });

  it('rechaza bases cuyo dv da 10 (no existe CUIT válido)', () => {
    expect(cuitEsValido('30715095966')).toBe(false);
  });

  it('rechaza longitudes y formatos inválidos', () => {
    expect(cuitEsValido('3071432565')).toBe(false); // 10 dígitos
    expect(cuitEsValido('307143256511')).toBe(false); // 12 dígitos
    expect(cuitEsValido('3071432565A')).toBe(false);
    expect(cuitEsValido('')).toBe(false);
    expect(cuitEsValido(null)).toBe(false);
    expect(cuitEsValido(undefined)).toBe(false);
  });

  it('normaliza y formatea', () => {
    expect(normalizarCuit('30-71432565-1')).toBe('30714325651');
    expect(formatearCuit('30714325651')).toBe('30-71432565-1');
  });
});

describe('identificador externo (proveedores sin CUIT)', () => {
  it('genera EXT- distintivo, nunca un CUIT válido', async () => {
    const { generarIdentificadorExterno, esIdentificadorExterno, cuitEsValido } = await import('@/lib/checks/cuit');
    const id = generarIdentificadorExterno();
    expect(id).toMatch(/^EXT-[0-9A-F]{8}$/);
    expect(esIdentificadorExterno(id)).toBe(true);
    expect(cuitEsValido(id)).toBe(false);
  });
  it('un CUIT normal no es identificador externo', async () => {
    const { esIdentificadorExterno } = await import('@/lib/checks/cuit');
    expect(esIdentificadorExterno('30712093486')).toBe(false);
    expect(esIdentificadorExterno(null)).toBe(false);
  });
});
