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
