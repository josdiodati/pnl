import type { ArcaConstatacion, ArcaInput, ArcaResultado } from './index';

// Deterministic mock (ARCA_MODE=mock, the default) so both outcomes are
// testable without network or credentials:
// - CAE ending in "00"  -> INVALIDO
// - empty / missing CAE -> ERROR_CONSULTA
// - anything else       -> VALIDO

export class ArcaConstatacionMock implements ArcaConstatacion {
  async constatar(input: ArcaInput): Promise<ArcaResultado> {
    const consultadoAt = new Date();
    if (!input.cae || !input.cae.trim()) {
      return { estado: 'ERROR_CONSULTA', detalle: 'Comprobante sin CAE para constatar (mock)', consultadoAt };
    }
    if (input.cae.trim().endsWith('00')) {
      return {
        estado: 'INVALIDO',
        detalle: 'El comprobante no figura autorizado en ARCA (mock determinístico: CAE termina en 00)',
        consultadoAt,
      };
    }
    return { estado: 'VALIDO', detalle: 'Comprobante autorizado (mock)', consultadoAt };
  }
}
