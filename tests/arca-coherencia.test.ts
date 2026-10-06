import { describe, it, expect } from 'vitest';
import { diferenciasConArca, normalizarMonedaArca } from '@/lib/arca/mis-comprobantes/coherencia';
import { evaluarAutovalidacion } from '@/lib/autovalidacion';

describe('diferenciasConArca', () => {
  it('detecta moneda distinta (QR en DOL, ARCA en pesos: caso ISECOM)', () => {
    const d = diferenciasConArca(
      { moneda: 'USD', tipoCambio: 1545, total: 2313462.3 },
      { moneda: '$', tipoCambio: 1, importeTotal: 2313462.3 },
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatch(/^moneda: ARCA dice ARS y el comprobante USD/);
  });

  it('coincide: pesos con pesos, o dólares con el mismo TC', () => {
    expect(diferenciasConArca({ moneda: 'ARS', tipoCambio: null, total: 89990 }, { moneda: '$', tipoCambio: 1, importeTotal: 89990 })).toEqual([]);
    expect(diferenciasConArca({ moneda: 'USD', tipoCambio: 1545, total: 100 }, { moneda: 'USD', tipoCambio: 1545, importeTotal: 100 })).toEqual([]);
  });

  it('detecta tipo de cambio e importe distintos', () => {
    const d = diferenciasConArca({ moneda: 'USD', tipoCambio: 1400, total: 100 }, { moneda: 'USD', tipoCambio: 1545, importeTotal: 120 });
    expect(d.map((x) => x.split(':')[0])).toEqual(['tipo de cambio', 'importe total']);
  });

  it('tolera redondeos', () => {
    expect(diferenciasConArca({ moneda: 'USD', tipoCambio: 1545.5, total: 100.05 }, { moneda: 'USD', tipoCambio: 1545, importeTotal: 100 })).toEqual([]);
  });

  it('normaliza los códigos de moneda', () => {
    expect(normalizarMonedaArca('$')).toBe('ARS');
    expect(normalizarMonedaArca('DOL')).toBe('USD');
    expect(normalizarMonedaArca(null)).toBeNull();
  });
});

describe('autovalidación con ARCA', () => {
  const base = {
    qrEstado: 'OK', esComprobanteFiscalArg: true, cae: '1', qrAporto: true,
    importes: { netoGravado: 100, iva21: 21 }, total: 121, hayDuplicados: false,
  };
  it('no autovalida si difiere de ARCA', () => {
    const r = evaluarAutovalidacion({ ...base, diferenciasArca: ['moneda: ARCA dice ARS y el comprobante USD'] });
    expect(r.apto).toBe(false);
    expect(r.motivos[0]).toMatch(/difiere de ARCA/);
  });
  it('coincidir con ARCA suma un chequeo aprobado; sin fila de ARCA no opina', () => {
    expect(evaluarAutovalidacion({ ...base, diferenciasArca: [] }).aprobados).toContain('coincide con ARCA (moneda, TC e importe)');
    expect(evaluarAutovalidacion(base).apto).toBe(true);
  });
});
