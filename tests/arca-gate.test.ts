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
