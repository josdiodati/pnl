import { describe, it, expect } from 'vitest';
import { clasificarDireccion } from '@/lib/pipeline';
import { origenConDireccion } from '@/lib/movimientos/service';

// Compra vs venta. El CUIT emisor manda, pero con contra-señales: el OCR a
// veces lee el CUIT del recuadro del cliente como si fuera del emisor (caso
// Galeno) y el comprobante quedaría como una venta imposible en la que la
// empresa se factura a sí misma.

describe('clasificarDireccion', () => {
  const KAWELLU = '30718332148';
  const base = {
    cuitReceptor: null,
    razonSocialEmisor: null,
    razonSocialReceptor: null,
    razonSocialEmpresa: null,
    cuitEmpresa: KAWELLU,
  };

  it('es VENTA cuando el emisor es la propia empresa', () => {
    const r = clasificarDireccion({ ...base, cuitEmisor: KAWELLU, cuitReceptor: '30709997579' });
    expect(r).toEqual({ direccion: 'VENTA', dudosa: false });
  });

  it('es COMPRA cuando el emisor es un tercero', () => {
    const r = clasificarDireccion({ ...base, cuitEmisor: '30582605021', cuitReceptor: KAWELLU });
    expect(r).toEqual({ direccion: 'COMPRA', dudosa: false });
  });

  it('es COMPRA por defecto cuando no se puede determinar el emisor', () => {
    const r = clasificarDireccion({ ...base, cuitEmisor: null, cuitReceptor: KAWELLU });
    expect(r).toEqual({ direccion: 'COMPRA', dudosa: false });
  });

  it('una venta genuina con razones sociales consistentes no es dudosa', () => {
    const r = clasificarDireccion({
      ...base,
      cuitEmisor: KAWELLU,
      razonSocialEmisor: 'Kawellu S.A.',
      razonSocialReceptor: 'Cliente Feliz SRL',
      razonSocialEmpresa: 'KAWELLU S.A.',
    });
    expect(r).toEqual({ direccion: 'VENTA', dudosa: false });
  });

  // Caso Galeno: el OCR puso el CUIT del recuadro del cliente como cuitEmisor,
  // pero las razones sociales dicen que la empresa es la RECEPTORA.
  it('si el receptor es la propia empresa (por nombre), es COMPRA dudosa aunque el CUIT emisor diga lo contrario', () => {
    const r = clasificarDireccion({
      ...base,
      cuitEmisor: KAWELLU,
      razonSocialEmisor: 'GALENO Argentina S.A.',
      razonSocialReceptor: 'KAWELLU S.A.',
      razonSocialEmpresa: 'Kawellu SA',
    });
    expect(r).toEqual({ direccion: 'COMPRA', dudosa: true });
  });

  it('si el receptor es la propia empresa (por CUIT), es COMPRA dudosa', () => {
    const r = clasificarDireccion({ ...base, cuitEmisor: KAWELLU, cuitReceptor: KAWELLU });
    expect(r).toEqual({ direccion: 'COMPRA', dudosa: true });
  });

  it('si el CUIT dice venta pero la razón social emisora es de un tercero (sin datos del receptor), queda VENTA dudosa', () => {
    const r = clasificarDireccion({
      ...base,
      cuitEmisor: KAWELLU,
      razonSocialEmisor: 'GALENO Argentina S.A.',
      razonSocialEmpresa: 'Kawellu SA',
    });
    expect(r).toEqual({ direccion: 'VENTA', dudosa: true });
  });
});

describe('origenConDireccion (corrección manual de compra/venta al validar)', () => {
  it('da vuelta un comprobante entre compra y venta', () => {
    expect(origenConDireccion('VENTA_COMPROBANTE', false)).toBe('COMPROBANTE');
    expect(origenConDireccion('COMPROBANTE', true)).toBe('VENTA_COMPROBANTE');
  });

  it('deja igual el que ya está en la dirección pedida', () => {
    expect(origenConDireccion('COMPROBANTE', false)).toBe('COMPROBANTE');
    expect(origenConDireccion('VENTA_COMPROBANTE', true)).toBe('VENTA_COMPROBANTE');
  });

  it('no toca los orígenes manuales: su dirección es intrínseca', () => {
    expect(origenConDireccion('ASIENTO_MANUAL', true)).toBe('ASIENTO_MANUAL');
    expect(origenConDireccion('VENTA_MANUAL', false)).toBe('VENTA_MANUAL');
  });
});
