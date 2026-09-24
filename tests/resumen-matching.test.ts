import { describe, it, expect } from 'vitest';
import { normalizarDescriptor, similitudTexto, evaluarLinea, type MovimientoCandidato } from '@/lib/resumenes/matching';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const anthropic: MovimientoCandidato = {
  id: 'mov-anthropic', total: 100, moneda: 'USD', fecha: d('2026-06-28'),
  nombreContraparte: 'Anthropic, PBC', descriptores: [],
};
const edesur: MovimientoCandidato = {
  id: 'mov-edesur', total: 259381.13, moneda: 'ARS', fecha: d('2026-07-09'),
  nombreContraparte: 'Edesur', descriptores: [],
};

describe('normalizarDescriptor y similitud', () => {
  it('normaliza mayúsculas, símbolos y espacios', () => {
    expect(normalizarDescriptor('ANTHROPIC* CLAUD  in1TnfMiB')).toBe('anthropic claud in1tnfmib');
  });
  it('similitud alta entre descriptor y contraparte', () => {
    expect(similitudTexto('anthropic claud', 'anthropic pbc')).toBeGreaterThan(0.4);
    expect(similitudTexto('starlink', 'edesur')).toBeLessThan(0.2);
  });
});

describe('evaluarLinea', () => {
  it('caso Anthropic: monto USD + fecha cercana + texto → SUGERIDA', () => {
    const r = evaluarLinea(
      { fecha: d('2026-06-29'), descriptor: 'ANTHROPIC* CLAUD', monto: null, montoOrigen: -100, moneda: 'USD' },
      [anthropic, edesur],
    );
    expect(r.estado).toBe('SUGERIDA');
    expect(r.candidatos[0].movimientoId).toBe('mov-anthropic');
  });

  it('monto exacto ARS + fecha cercana → SUGERIDA aun sin texto', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-10'), descriptor: 'DEB AUT LUZ 999', monto: -259381.13, montoOrigen: null, moneda: 'ARS' },
      [edesur],
    );
    expect(r.estado).toBe('SUGERIDA');
  });

  it('sólo coincide el texto → PENDIENTE con candidatos', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-20'), descriptor: 'EDESUR CUOTA PLAN', monto: -50000, montoOrigen: null, moneda: 'ARS' },
      [edesur],
    );
    expect(r.estado).toBe('PENDIENTE');
    expect(r.candidatos.length).toBeGreaterThan(0);
  });

  it('sin señales → PENDIENTE sin candidatos', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-01'), descriptor: 'SIRCREB RECAUDACION', monto: -2210576.35, montoOrigen: null, moneda: 'ARS' },
      [anthropic, edesur],
    );
    expect(r.candidatos).toHaveLength(0);
  });

  it('descriptor aprendido matchea con confianza alta', () => {
    const conAprendido = { ...edesur, total: 111, descriptores: ['edesur cuota plan'] };
    const r = evaluarLinea(
      { fecha: d('2026-07-20'), descriptor: 'EDESUR CUOTA PLAN', monto: -111, montoOrigen: null, moneda: 'ARS' },
      [conAprendido],
    );
    expect(r.estado).toBe('SUGERIDA');
  });
});

describe('evaluarLinea: ventas y cobros (Spec F)', () => {
  const comnet: MovimientoCandidato = {
    id: 'venta-685', total: 15136816.51, moneda: 'ARS', fecha: d('2026-07-31'),
    nombreContraparte: 'COMNET S A', descriptores: ['pago a proveedores recibido comnet sa'],
    venta: { saldo: 15136816.51, saldoArs: 15136816.51 },
  };
  const credito = (monto: number, fecha = '2026-08-13', descriptor = 'Pago a proveedores recibido Comnet sa 30661571663') =>
    ({ fecha: d(fecha), descriptor, monto, montoOrigen: null, moneda: 'ARS' });

  it('un crédito neto de retenciones (≤5%) sugiere la venta', () => {
    const r = evaluarLinea(credito(14886621.17), [comnet]);
    expect(r.estado).toBe('SUGERIDA');
    expect(r.candidatos[0].motivo).toContain('neto de retenciones');
  });

  it('se compara contra el saldo, no contra el total', () => {
    const parcial = { ...comnet, venta: { saldo: 5000000, saldoArs: 5000000 } };
    expect(evaluarLinea(credito(5000000), [parcial]).estado).toBe('SUGERIDA');
    expect(evaluarLinea(credito(15136816.51), [parcial]).candidatos[0]?.motivo ?? '').not.toContain('monto');
  });

  it('una venta nunca matchea por monto contra un débito', () => {
    const r = evaluarLinea(credito(-15136816.51, '2026-08-13', 'DEBITO VARIO'), [comnet]);
    expect(r.candidatos).toHaveLength(0);
  });

  it('venta en USD: crédito en pesos dentro de ±5% del saldo pesificado', () => {
    const cube: MovimientoCandidato = {
      id: 'venta-170', total: 24775.17, moneda: 'USD', fecha: d('2026-08-19'),
      nombreContraparte: 'Cubecorp', descriptores: [], venta: { saldo: 24775.17, saldoArs: 24775.17 * 1495 },
    };
    const r = evaluarLinea({ fecha: d('2026-08-19'), descriptor: 'Comex - cobro exportacion de serv', monto: 36505077.66, montoOrigen: null, moneda: 'ARS' }, [cube]);
    expect(r.estado).toBe('SUGERIDA');
    expect(r.candidatos[0].motivo).toContain('tipo de cambio');
  });

  it('un cobro registrado aparece con su etiqueta y la venta no se repite', () => {
    const cobro: MovimientoCandidato = {
      id: 'venta-685', total: 14886621.17, moneda: 'ARS', fecha: d('2026-08-13'),
      nombreContraparte: 'COMNET S A', descriptores: [], etiqueta: 'cobro registrado: Transferencia',
    };
    const r = evaluarLinea(credito(14886621.17), [comnet, cobro]);
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0].motivo).toMatch(/^cobro registrado: Transferencia \+ monto exacto/);
  });
});
