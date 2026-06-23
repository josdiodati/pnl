import { describe, it, expect } from 'vitest';
import { MockExtractor } from '@/lib/extractor/mock';

describe('MockExtractor: contrato ExtractorResult', () => {
  const ext = new MockExtractor();

  it('devuelve { extraccion, uso } y uso es null (mock no consume tokens)', async () => {
    const r = await ext.extract({
      buffer: Buffer.from('contenido de un comprobante de prueba'),
      mime: 'application/pdf',
      filename: 'comprobante.pdf',
    });
    expect(r.extraccion).toBeTruthy();
    expect(r.extraccion.total).not.toBeNull();
    expect(r.uso).toBeNull();
  });

  it('un archivo con "error" en el nombre lanza (ejercita el path de fallo)', async () => {
    await expect(
      ext.extract({ buffer: Buffer.from('x'), mime: 'application/pdf', filename: 'factura-error.pdf' }),
    ).rejects.toThrow();
  });
});
