import { describe, it, expect } from 'vitest';
import { decidirAltaContraparte, type EntradaAltaContraparte } from '@/lib/contrapartes/alta-automatica';

// El alta automática se ancla en el QR de ARCA: es la única fuente autoritativa
// de la IDENTIDAD (el CUIT). El QR no trae razón social, así que el nombre sale
// de la extracción del LLM — pero como el CUIT es único por empresa, un CUIT
// nunca puede generar dos contrapartes; el nombre es solo la etiqueta.

const compra: EntradaAltaContraparte = {
  direccion: 'COMPRA',
  cuitContraparte: '30656631615',
  cuitDesdeQr: true,
  razonSocialEmisor: 'ADT Security Services S.A.',
  razonSocialReceptor: 'Ewwo Consulting S.R.L.',
  yaExiste: false,
};

describe('decidirAltaContraparte', () => {
  it('da de alta al emisor en una compra con QR', () => {
    const d = decidirAltaContraparte(compra);
    expect(d).toEqual({ crear: true, cuit: '30656631615', razonSocial: 'ADT Security Services S.A.', tipo: 'PROVEEDOR' });
  });

  it('da de alta al receptor en una venta, como CLIENTE', () => {
    const d = decidirAltaContraparte({ ...compra, direccion: 'VENTA' });
    expect(d).toEqual({ crear: true, cuit: '30656631615', razonSocial: 'Ewwo Consulting S.R.L.', tipo: 'CLIENTE' });
  });

  it('NO da de alta si el CUIT no vino del QR: sin identidad autoritativa no se toca el maestro', () => {
    const d = decidirAltaContraparte({ ...compra, cuitDesdeQr: false });
    expect(d.crear).toBe(false);
  });

  it('NO da de alta si ya existe en el maestro', () => {
    const d = decidirAltaContraparte({ ...compra, yaExiste: true });
    expect(d.crear).toBe(false);
  });

  it('NO da de alta sin CUIT', () => {
    const d = decidirAltaContraparte({ ...compra, cuitContraparte: null });
    expect(d.crear).toBe(false);
  });

  it('NO da de alta sin razón social: no hay etiqueta que ponerle', () => {
    const d = decidirAltaContraparte({ ...compra, razonSocialEmisor: null });
    expect(d.crear).toBe(false);
  });

  it('recorta la razón social y descarta la que viene en blanco', () => {
    expect(decidirAltaContraparte({ ...compra, razonSocialEmisor: '  ADT S.A.  ' })).toMatchObject({ razonSocial: 'ADT S.A.' });
    expect(decidirAltaContraparte({ ...compra, razonSocialEmisor: '   ' }).crear).toBe(false);
  });

  it('cada motivo de no-alta queda explicado', () => {
    const d = decidirAltaContraparte({ ...compra, cuitDesdeQr: false });
    if (d.crear) throw new Error('esperaba que no creara');
    expect(d.motivo).toMatch(/QR/i);
  });
});
