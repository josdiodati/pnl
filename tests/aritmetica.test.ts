import { describe, it, expect } from 'vitest';
import { checkAritmetica } from '@/lib/checks/aritmetica';
import { evaluarCampos } from '@/lib/checks';
import type { Extraccion } from '@/lib/extractor/schema';

describe('check aritmético: componentes vs total (±$1)', () => {
  it('acepta una factura que cierra exacto', () => {
    const r = checkAritmetica({ netoGravado: 1000, iva21: 210, total: 1210 });
    expect(r.ok).toBe(true);
    expect(r.diferencia).toBe(0);
  });

  it('acepta diferencias de redondeo dentro de ±$1', () => {
    expect(checkAritmetica({ netoGravado: 1000, iva21: 210.5, total: 1209.6 }).ok).toBe(true);
    expect(checkAritmetica({ netoGravado: 1000, iva21: 209, total: 1210 }).ok).toBe(true);
  });

  it('rechaza diferencias mayores a $1', () => {
    const r = checkAritmetica({ netoGravado: 1000, iva21: 210, total: 1310 });
    expect(r.ok).toBe(false);
    expect(r.diferencia).toBe(-100);
  });

  it('suma todos los componentes (percepciones y tributos incluidos)', () => {
    const r = checkAritmetica({
      netoGravado: 1000,
      iva21: 210,
      iva105: 52.5,
      iva27: 27,
      percepcionesIva: 30,
      percepcionesIibb: 25,
      otrosTributos: 10,
      noGravadoExento: 100,
      total: 1454.5,
    });
    expect(r.ok).toBe(true);
  });

  it('no usa aritmética flotante (0.1+0.2)', () => {
    expect(checkAritmetica({ netoGravado: 0.1, iva21: 0.2, total: 0.3 }).ok).toBe(true);
  });

  it('rechaza total ausente', () => {
    expect(checkAritmetica({ netoGravado: 1000, total: null }).ok).toBe(false);
  });
});

describe('evaluarCampos: marca campos a revisar', () => {
  const base: Extraccion = {
    tipoComprobante: 'FACTURA_A',
    puntoVenta: '0001',
    numero: '00001234',
    fechaEmision: new Date().toISOString().slice(0, 10),
    cuitEmisor: '30714325651',
    razonSocialEmisor: 'Proveedor SA',
    netoGravado: 1000,
    iva21: 210,
    iva105: null,
    iva27: null,
    percepcionesIva: null,
    percepcionesIibb: null,
    otrosTributos: null,
    noGravadoExento: null,
    total: 1210,
    moneda: 'ARS',
    cae: '70123456789012',
    vencimientoCae: null,
    cuitReceptor: null,
    razonSocialReceptor: null,
    esComprobanteFiscalArg: true,
    confianza: {},
    observaciones: null,
  };

  it('comprobante limpio: sin campos a revisar', () => {
    expect(evaluarCampos(base)).toEqual({});
  });

  it('CUIT inválido → revisar cuitEmisor', () => {
    expect(evaluarCampos({ ...base, cuitEmisor: '30714325650' })).toHaveProperty('cuitEmisor');
  });

  it('aritmética rota → revisar total', () => {
    expect(evaluarCampos({ ...base, total: 9999 })).toHaveProperty('total');
  });

  it('fecha futura → revisar fechaEmision', () => {
    const futura = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    expect(evaluarCampos({ ...base, fechaEmision: futura })).toHaveProperty('fechaEmision');
  });

  it('fecha de más de 5 años → revisar fechaEmision', () => {
    expect(evaluarCampos({ ...base, fechaEmision: '2015-01-01' })).toHaveProperty('fechaEmision');
  });

  it('factura A sin IVA discriminado → alerta blanda', () => {
    expect(evaluarCampos({ ...base, iva21: null, total: 1000 })).toHaveProperty('iva21');
  });

  it('confianza baja → revisar ese campo', () => {
    expect(evaluarCampos({ ...base, confianza: { numero: 0.4 } })).toHaveProperty('numero');
  });
});
