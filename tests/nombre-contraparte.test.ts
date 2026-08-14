import { describe, it, expect } from 'vitest';
import { esVenta, nombreContraparte, type MovimientoParaNombre } from '@/lib/movimientos/nombre-contraparte';

// La contraparte es el EMISOR en compras y el RECEPTOR en ventas. Cuando todavía
// no está en el maestro (el pipeline solo la vincula si ya existe), las colas
// muestran el nombre extraído del comprobante en vez de dejar el campo vacío.

const compra: MovimientoParaNombre = {
  origen: 'COMPROBANTE',
  contraparte: null,
  cuitEmisor: '30656631615',
  extraccionRaw: { razonSocialEmisor: 'ADT Security Services S.A.', razonSocialReceptor: 'Ewwo Consulting S.R.L.' },
};

const venta: MovimientoParaNombre = {
  origen: 'VENTA_COMPROBANTE',
  contraparte: null,
  cuitEmisor: '30111111118',
  extraccionRaw: { razonSocialEmisor: 'Ewwo Consulting S.R.L.', razonSocialReceptor: 'Cliente S.A.' },
};

describe('esVenta', () => {
  it('distingue ventas de compras por origen', () => {
    expect(esVenta('VENTA_COMPROBANTE')).toBe(true);
    expect(esVenta('VENTA_MANUAL')).toBe(true);
    expect(esVenta('COMPROBANTE')).toBe(false);
    expect(esVenta('ASIENTO_MANUAL')).toBe(false);
  });
});

describe('nombreContraparte', () => {
  it('el maestro manda sobre lo extraído', () => {
    const r = nombreContraparte({ ...compra, contraparte: { razonSocial: 'ADT SECURITY SERVICES SA' } });
    expect(r.nombre).toBe('ADT SECURITY SERVICES SA');
    expect(r.esNueva).toBe(false);
  });

  it('en compras cae al emisor extraído y la marca como nueva', () => {
    const r = nombreContraparte(compra);
    expect(r.nombre).toBe('ADT Security Services S.A.');
    expect(r.esNueva).toBe(true);
  });

  it('en ventas cae al receptor extraído, no al emisor', () => {
    const r = nombreContraparte(venta);
    expect(r.nombre).toBe('Cliente S.A.');
  });

  it('sin maestro ni extracción queda sin identificar', () => {
    const r = nombreContraparte({ ...compra, extraccionRaw: null });
    expect(r.nombre).toBeNull();
    expect(r.esNueva).toBe(true);
  });

  it('una razón social en blanco cuenta como ausente', () => {
    const r = nombreContraparte({ ...compra, extraccionRaw: { razonSocialEmisor: '   ' } });
    expect(r.nombre).toBeNull();
  });

  it('sin CUIT no la marca como nueva: no hay identidad que dar de alta', () => {
    const r = nombreContraparte({ ...compra, cuitEmisor: null });
    expect(r.nombre).toBe('ADT Security Services S.A.');
    expect(r.esNueva).toBe(false);
  });
});
