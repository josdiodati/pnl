import { describe, it, expect } from 'vitest';
import { parseAfipQrUrl } from '@/lib/extractor/qr';

// JSON real de ejemplo del estándar de QR de AFIP/ARCA (RG 4892), con receptor.
const PAYLOAD = {
  ver: 1, fecha: '2026-06-01', cuit: 30718332148, ptoVta: 1, tipoCmp: 1,
  nroCmp: 349, importe: 1874379.54, moneda: 'PES', ctz: 1, tipoDocRec: 80,
  nroDocRec: 30709997579, tipoCodAut: 'E', codAut: 86228096232912,
};
const b64 = Buffer.from(JSON.stringify(PAYLOAD)).toString('base64');

describe('parseAfipQrUrl', () => {
  it('decodifica un QR con host arca.gob.ar (AFIP renombrado a ARCA)', () => {
    const q = parseAfipQrUrl('https://www.arca.gob.ar/fe/qr/?p=' + b64);
    expect(q).not.toBeNull();
    expect(q!.cuit).toBe(30718332148);
    expect(q!.nroDocRec).toBe(30709997579); // receptor
    expect(q!.importe).toBeCloseTo(1874379.54, 2);
    expect(q!.codAut).toBe(86228096232912);
  });

  it('sigue aceptando el host viejo afip.gob.ar', () => {
    const q = parseAfipQrUrl('https://www.afip.gob.ar/fe/qr/?p=' + b64);
    expect(q?.cuit).toBe(30718332148);
  });

  it('rechaza un host que no es de AFIP/ARCA', () => {
    expect(parseAfipQrUrl('https://example.com/fe/qr/?p=' + b64)).toBeNull();
  });

  it('rechaza hosts que solo terminan parecido (anti-spoofing)', () => {
    expect(parseAfipQrUrl('https://evil-arca.gob.ar/fe/qr/?p=' + b64)).toBeNull();
    expect(parseAfipQrUrl('https://arca.gob.ar.evil.com/fe/qr/?p=' + b64)).toBeNull();
  });

  it('devuelve null para un payload corrupto', () => {
    expect(parseAfipQrUrl('https://www.arca.gob.ar/fe/qr/?p=no-es-base64-json')).toBeNull();
  });
});
