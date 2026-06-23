import { describe, it, expect } from 'vitest';
import { clasificarDireccion } from '@/lib/pipeline';

describe('clasificarDireccion', () => {
  const KAWELLU = '30718332148';

  it('es VENTA cuando el emisor es la propia empresa', () => {
    expect(clasificarDireccion(KAWELLU, '30709997579', KAWELLU)).toBe('VENTA');
  });

  it('es COMPRA cuando el emisor es un tercero', () => {
    expect(clasificarDireccion('30582605021', KAWELLU, KAWELLU)).toBe('COMPRA');
  });

  it('es COMPRA por defecto cuando no se puede determinar el emisor', () => {
    expect(clasificarDireccion(null, KAWELLU, KAWELLU)).toBe('COMPRA');
  });
});
