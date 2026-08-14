import { describe, it, expect } from 'vitest';
import { puedeValidarArca } from '@/lib/movimientos/service';

describe('puedeValidarArca: gate de ARCA con override', () => {
  it('permite validar cuando ARCA es VALIDO', () => {
    expect(puedeValidarArca('VALIDO', {}).ok).toBe(true);
  });

  it('bloquea INVALIDO sin confirmación', () => {
    expect(puedeValidarArca('INVALIDO', {}).ok).toBe(false);
  });

  it('permite INVALIDO con confirmarArcaInvalido', () => {
    expect(puedeValidarArca('INVALIDO', { confirmarArcaInvalido: true }).ok).toBe(true);
  });

  it('bloquea NO_VERIFICADO sin override', () => {
    expect(puedeValidarArca('NO_VERIFICADO', {}).ok).toBe(false);
  });

  it('permite NO_VERIFICADO con override no-fiscal + motivo', () => {
    const r = puedeValidarArca('NO_VERIFICADO', { overrideNoFiscal: true, overrideNoFiscalMotivo: 'Servicio AWS sin comprobante AR' });
    expect(r.ok).toBe(true);
  });

  it('bloquea override no-fiscal sin motivo', () => {
    expect(puedeValidarArca('NO_VERIFICADO', { overrideNoFiscal: true }).ok).toBe(false);
  });

  it('aplica el override no-fiscal también a ERROR_CONSULTA', () => {
    expect(puedeValidarArca('ERROR_CONSULTA', { overrideNoFiscal: true, overrideNoFiscalMotivo: 'x' }).ok).toBe(true);
  });
});

// El destiempo de ARCA: un comprobante fiscal con CAE puede estar todavía sin
// constatar (el job no corrió, el WS demoró, o el validador acaba de tipear el
// CAE a mano). Eso NO es lo mismo que un comprobante no constatable, que es para
// lo que existe el override.
describe('puedeValidarArca: pendiente de constatación vs no constatable', () => {
  it('con CAE sin constatar deja validar sin override', () => {
    expect(puedeValidarArca('NO_VERIFICADO', { cae: '86316649232909' }).ok).toBe(true);
    expect(puedeValidarArca('ERROR_CONSULTA', { cae: '86316649232909' }).ok).toBe(true);
  });

  it('sin CAE sigue exigiendo el override con motivo', () => {
    expect(puedeValidarArca('NO_VERIFICADO', { cae: null }).ok).toBe(false);
    expect(puedeValidarArca('NO_VERIFICADO', { cae: '   ' }).ok).toBe(false);
    expect(puedeValidarArca('NO_VERIFICADO', { cae: null, overrideNoFiscal: true, overrideNoFiscalMotivo: 'AWS' }).ok).toBe(true);
  });

  it('un CAE no habilita nada si ARCA ya dijo que es inválido', () => {
    expect(puedeValidarArca('INVALIDO', { cae: '86316649232909' }).ok).toBe(false);
  });
});
