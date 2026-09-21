import { describe, it, expect } from 'vitest';
import { buscarExternaPorNombre } from '@/lib/contrapartes/externa';

// Un proveedor extranjero no tiene CUIT: se lo identifica con un EXT- aleatorio.
// Como el azar nunca coincide, la única forma de no duplicarlo cuando se lo
// vuelve a dar de alta es reconocerlo por nombre entre los EXT- existentes.

const existentes = [
  { id: 'a1', cuit: 'EXT-ADDFA210', razonSocial: 'Anthropic, PBC' },
  { id: 'b2', cuit: 'EXT-5DC83994', razonSocial: 'Atlassian Pty Ltd' },
  { id: 'c3', cuit: '30639453738', razonSocial: 'TELECOM ARGENTINA S.A.' },
];

describe('buscarExternaPorNombre', () => {
  it('reutiliza la externa existente cuando el nombre coincide exactamente', () => {
    expect(buscarExternaPorNombre('Anthropic, PBC', existentes)?.id).toBe('a1');
  });

  it('coincide ignorando mayúsculas, puntuación y espacios', () => {
    expect(buscarExternaPorNombre('  anthropic pbc ', existentes)?.id).toBe('a1');
    expect(buscarExternaPorNombre('ATLASSIAN PTY. LTD.', existentes)?.id).toBe('b2');
  });

  it('devuelve null si ninguna externa tiene ese nombre', () => {
    expect(buscarExternaPorNombre('Kinsta Inc.', existentes)).toBeNull();
  });

  it('nunca reutiliza una contraparte con CUIT real aunque el nombre coincida', () => {
    expect(buscarExternaPorNombre('Telecom Argentina SA', existentes)).toBeNull();
  });

  it('devuelve null con nombre vacío', () => {
    expect(buscarExternaPorNombre('   ', existentes)).toBeNull();
  });
});
