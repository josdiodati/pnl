import { describe, it, expect } from 'vitest';
import { parseAfipQrUrl } from '@/lib/extractor/qr';

// JSON real de ejemplo del estándar de QR de AFIP (RG 4892).
const PAYLOAD = {
  ver: 1, fecha: '2026-06-01', cuit: 30718332148, ptoVta: 1, tipoCmp: 1,
  nroCmp: 349, importe: 1874379.54, moneda: 'PES', ctz: 1, tipoDocRec: 80,
  nroDocRec: 30709997579, tipoCodAut: 'E', codAut: 86228096232912,
};
const URL = 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(PAYLOAD)).toString('base64');

describe('parseAfipQrUrl', () => {
  it('decodifica un QR de AFIP válido', () => {
    const q = parseAfipQrUrl(URL);
    expect(q).not.toBeNull();
    expect(q!.cuit).toBe(30718332148);
    expect(q!.nroCmp).toBe(349);
    expect(q!.codAut).toBe(86228096232912);
    expect(q!.importe).toBeCloseTo(1874379.54, 2);
  });

  it('devuelve null para una URL que no es de AFIP', () => {
    expect(parseAfipQrUrl('https://example.com/foo')).toBeNull();
  });

  it('devuelve null para un payload corrupto', () => {
    expect(parseAfipQrUrl('https://www.afip.gob.ar/fe/qr/?p=no-es-base64-json')).toBeNull();
  });
});
