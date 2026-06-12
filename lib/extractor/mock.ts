import { createHash } from 'node:crypto';
import { extraccionSchema, type Extraccion } from './schema';
import type { DocumentExtractor, ExtractorInput } from './index';

// Deterministic extractor used by default (EXTRACTOR_MODE=mock). Two behaviors:
//
// 1. If the file contains an embedded `PNL-MOCK:{...json...}` marker (the seed
//    PDFs include one), it "reads" the document and returns exactly that data —
//    a faithful simulation of perfect OCR, fully deterministic for demos/tests.
// 2. Otherwise it derives plausible voucher data from the file's SHA-256, so
//    any uploaded file flows end-to-end without credentials.
//
// A filename containing "error" forces a failure, to exercise retries and the
// ERROR_PROCESAMIENTO path.

// Valid CUITs (correct check digit) used for hash-derived data; they match
// some of the seed contrapartes so uploads auto-match the master.
const CUITS_DEMO = [
  '30714325651',
  '20128364847',
  '27234567891',
  '30500010912',
  '30700000008',
];

function hashInt(buffer: Buffer, salt: string): number {
  const h = createHash('sha256').update(salt).update(buffer).digest();
  return h.readUInt32BE(0);
}

export class MockExtractor implements DocumentExtractor {
  async extract(input: ExtractorInput): Promise<Extraccion> {
    if (input.filename.toLowerCase().includes('error')) {
      throw new Error('Extracción simulada fallida (el nombre del archivo contiene "error")');
    }

    // Behavior 1: embedded marker (seed fixtures / tests)
    const text = input.buffer.toString('latin1');
    const marker = text.match(/PNL-MOCK:(\{.*?\})\s*(?:\)|$|\n)/s);
    if (marker) {
      const parsed = JSON.parse(marker[1]);
      return extraccionSchema.parse({ confianza: {}, observaciones: null, moneda: 'ARS', ...parsed });
    }

    // Behavior 2: hash-derived plausible voucher
    const n = (salt: string, mod: number) => hashInt(input.buffer, salt) % mod;
    const neto = Math.round((n('neto', 9_000_00) + 100_000) ) / 100; // $1.000,00 .. $91.000,00
    const iva21 = Math.round(neto * 21) / 100;
    const total = Math.round((neto + iva21) * 100) / 100;
    const diasAtras = n('fecha', 25) + 1;
    const fecha = new Date(Date.now() - diasAtras * 24 * 3600 * 1000);
    const cae = String(70000000000000 + (hashInt(input.buffer, 'cae') % 9999999999));
    const numero = String(1 + n('numero', 99999999)).padStart(8, '0');

    return extraccionSchema.parse({
      tipoComprobante: 'FACTURA_A',
      puntoVenta: String(1 + n('pv', 30)).padStart(4, '0'),
      numero,
      fechaEmision: fecha.toISOString().slice(0, 10),
      cuitEmisor: CUITS_DEMO[n('cuit', CUITS_DEMO.length)],
      razonSocialEmisor: `Proveedor Demo ${1 + n('rz', 5)} S.A.`,
      netoGravado: neto,
      iva21,
      iva105: null,
      iva27: null,
      percepcionesIva: null,
      percepcionesIibb: null,
      otrosTributos: null,
      noGravadoExento: null,
      total,
      moneda: 'ARS',
      cae,
      vencimientoCae: new Date(fecha.getTime() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      confianza: Object.fromEntries(
        ['tipoComprobante', 'numero', 'fechaEmision', 'cuitEmisor', 'netoGravado', 'iva21', 'total'].map((c) => [
          c,
          0.85 + (n(c, 15) / 100),
        ]),
      ),
      observaciones: 'Extracción simulada (EXTRACTOR_MODE=mock)',
    });
  }
}
