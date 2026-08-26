import { describe, it, expect } from 'vitest';
import { totalFirmadoDe, type MovimientoConRelaciones } from '@/lib/movimientos/query';
import { evaluarAutovalidacion } from '@/lib/autovalidacion';

// Moneda extranjera: el libro unifica en pesos con el tipo de cambio del
// comprobante (total × TC). Sin TC el movimiento no computa (queda sin signo)
// y no puede validarse ni autovalidarse.

const base: MovimientoConRelaciones = {
  id: 'm1',
  estado: 'ASIGNADO',
  total: 100,
  tipoComprobante: 'FACTURA_E',
  categoria: { tipo: 'INGRESO', nombre: 'Ventas' },
  lineas: [],
};

describe('totalFirmadoDe con moneda extranjera', () => {
  it('convierte a pesos con el tipo de cambio (centavos exactos)', () => {
    const firmado = totalFirmadoDe({ ...base, moneda: 'USD', tipoCambio: 1325.5 });
    expect(firmado).toBe(Math.round(100 * 1325.5 * 100)); // 13.255.000 centavos
  });

  it('sin tipo de cambio una moneda extranjera no computa', () => {
    expect(totalFirmadoDe({ ...base, moneda: 'USD' })).toBeNull();
    expect(totalFirmadoDe({ ...base, moneda: 'USD', tipoCambio: null })).toBeNull();
  });

  it('en pesos nada cambia (con o sin campo moneda)', () => {
    expect(totalFirmadoDe(base)).toBe(10_000);
    expect(totalFirmadoDe({ ...base, moneda: 'ARS' })).toBe(10_000);
  });
});

describe('autovalidación con moneda extranjera', () => {
  const entrada = {
    qrEstado: 'OK' as const,
    esComprobanteFiscalArg: true,
    cae: '123',
    qrAporto: true,
    importes: { netoGravado: 100, iva21: null, iva105: null, iva27: null, percepcionesIva: null, percepcionesIibb: null, otrosTributos: null, noGravadoExento: null },
    total: 100,
    hayDuplicados: false,
  };

  it('moneda extranjera sin TC no es apta', () => {
    const r = evaluarAutovalidacion({ ...entrada, moneda: 'USD', tipoCambio: null });
    expect(r.apto).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/tipo de cambio/);
  });

  it('con TC (del QR) sí puede autovalidar', () => {
    expect(evaluarAutovalidacion({ ...entrada, moneda: 'USD', tipoCambio: 1325 }).apto).toBe(true);
  });

  it('en pesos no exige TC', () => {
    expect(evaluarAutovalidacion({ ...entrada, moneda: 'ARS', tipoCambio: null }).apto).toBe(true);
  });
});
