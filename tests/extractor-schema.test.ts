import { describe, it, expect } from 'vitest';
import { extraccionSchema } from '@/lib/extractor/schema';

describe('extraccionSchema: campos de receptor y flag fiscal', () => {
  it('parsea un comprobante con receptor y flag fiscal', () => {
    const e = extraccionSchema.parse({
      tipoComprobante: 'FACTURA_A',
      total: 1210,
      moneda: 'ARS',
      cuitReceptor: '30718332148',
      razonSocialReceptor: 'Kawellu Soluciones S.R.L.',
      esComprobanteFiscalArg: true,
    });
    expect(e.cuitReceptor).toBe('30718332148');
    expect(e.razonSocialReceptor).toBe('Kawellu Soluciones S.R.L.');
    expect(e.esComprobanteFiscalArg).toBe(true);
  });

  it('toma defaults cuando faltan los campos nuevos', () => {
    const e = extraccionSchema.parse({ tipoComprobante: 'TICKET', total: 100, moneda: 'ARS' });
    expect(e.cuitReceptor).toBeNull();
    expect(e.razonSocialReceptor).toBeNull();
    expect(e.esComprobanteFiscalArg).toBe(false);
  });
});
