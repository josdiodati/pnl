import { describe, it, expect } from 'vitest';
import { decidirAltaContraparte, esLaPropiaEmpresa, type EntradaAltaContraparte } from '@/lib/contrapartes/alta-automatica';

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

// El LLM a veces invierte emisor y receptor: lee a la propia empresa como si
// hubiera emitido la factura. El QR corrige el CUIT (identidad) pero NO el
// nombre, porque no lo trae. Sin este chequeo se da de alta un proveedor con el
// CUIT correcto y el nombre del comprador.
//
// La señal que discrimina es el NOMBRE, no el CUIT: cuando el LLM sólo lee mal
// unos dígitos del CUIT igual acierta el nombre, y ese caso debe seguir dándose
// de alta. Cuando invierte los roles, el nombre que ofrece es el nuestro.
describe('decidirAltaContraparte: inversión de roles del LLM', () => {
  const empresa = { razonSocialEmpresa: 'Ewwo Consulting S.R.L.', cuitEmpresa: '30712093486' };

  it('NO da de alta una contraparte con el nombre de la propia empresa', () => {
    const d = decidirAltaContraparte({
      ...compra,
      ...empresa,
      cuitContraparte: '30714981265',
      razonSocialEmisor: 'EWWO CONSULTING S.R.L.',
    });
    expect(d.crear).toBe(false);
    if (d.crear) throw new Error('no debería crear');
    expect(d.motivo).toMatch(/propia empresa/i);
  });

  it('compara los nombres sin depender de mayúsculas, puntos ni espacios', () => {
    const d = decidirAltaContraparte({
      ...compra,
      ...empresa,
      cuitContraparte: '30714981265',
      razonSocialEmisor: 'ewwo  consulting srl',
    });
    expect(d.crear).toBe(false);
  });

  it('un CUIT mal leído con el nombre correcto SÍ se da de alta', () => {
    const d = decidirAltaContraparte({ ...compra, ...empresa, cuitContraparte: '30702652975', razonSocialEmisor: 'NSS SA' });
    expect(d.crear).toBe(true);
  });

  it('tampoco se da de alta si el CUIT de la contraparte es el nuestro', () => {
    const d = decidirAltaContraparte({ ...compra, ...empresa, cuitContraparte: '30712093486' });
    expect(d.crear).toBe(false);
  });

  it('el caso normal no se ve afectado', () => {
    expect(decidirAltaContraparte({ ...compra, ...empresa }).crear).toBe(true);
  });

  it('sin datos de la empresa no rompe: se comporta como antes', () => {
    expect(decidirAltaContraparte(compra).crear).toBe(true);
  });
});

// Misma regla que usa el alta automática, expuesta para que la limpieza de datos
// ya ensuciados no pueda divergir de la prevención.
describe('esLaPropiaEmpresa', () => {
  const empresa = { cuit: '30712093486', razonSocial: 'Ewwo Consulting S.R.L.' };

  it('detecta por nombre aunque cambie el formato', () => {
    expect(esLaPropiaEmpresa({ cuit: '30714981265', razonSocial: 'EWWO CONSULTING S.R.L.' }, empresa)).toBe(true);
    expect(esLaPropiaEmpresa({ cuit: '30714981265', razonSocial: 'ewwo consulting srl' }, empresa)).toBe(true);
  });

  it('detecta por CUIT', () => {
    expect(esLaPropiaEmpresa({ cuit: '30712093486', razonSocial: 'Otra cosa' }, empresa)).toBe(true);
  });

  it('un proveedor normal no lo es', () => {
    expect(esLaPropiaEmpresa({ cuit: '30656631615', razonSocial: 'ADT Security Services S.A.' }, empresa)).toBe(false);
  });

  it('sin datos de la empresa no marca nada', () => {
    expect(esLaPropiaEmpresa({ cuit: '30656631615', razonSocial: 'X' }, { cuit: null, razonSocial: null })).toBe(false);
  });
});
