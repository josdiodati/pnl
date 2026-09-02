import { describe, it, expect } from 'vitest';
import { prepararTextoDocumento } from '@/lib/extractor/texto';
import { textoDeMatching, textoDocumentoDe } from '@/lib/reglas/matching';
import { extraccionSchema } from '@/lib/extractor/schema';
import { ocrParaRegla } from '@/lib/reglas/ocr-para-regla';

describe('prepararTextoDocumento', () => {
  it('normaliza espacios dentro de cada línea y descarta líneas vacías', () => {
    expect(prepararTextoDocumento('  Bill to \n\n  EWWO   CONSULTING SRL \n apalmieri@ewwoconsulting.com  \n\n')).toBe(
      'Bill to\nEWWO CONSULTING SRL\napalmieri@ewwoconsulting.com',
    );
  });
  it('trunca a 4000 caracteres', () => {
    const largo = 'palabra '.repeat(1000);
    expect(prepararTextoDocumento(largo)!.length).toBeLessThanOrEqual(4000);
  });
  it('vacío o solo espacios → null', () => {
    expect(prepararTextoDocumento('   \n  ')).toBeNull();
    expect(prepararTextoDocumento(null)).toBeNull();
  });
});

describe('textoDeMatching', () => {
  it('combina razón social + descripción + texto del documento', () => {
    const t = textoDeMatching({
      razonSocial: 'Anthropic, PBC',
      descripcion: 'Max plan - 5x',
      textoDocumento: 'Bill to\nEWWO CONSULTING SRL\napalmieri@ewwoconsulting.com',
    });
    expect(t).toContain('Anthropic, PBC');
    expect(t).toContain('Max plan - 5x');
    expect(t).toContain('apalmieri@ewwoconsulting.com');
  });
  it('sin texto del documento se comporta como antes (razón social + descripción)', () => {
    expect(textoDeMatching({ razonSocial: 'Telecom', descripcion: 'internet', textoDocumento: null })).toBe('Telecom internet');
  });
  it('tolera todo null', () => {
    expect(textoDeMatching({ razonSocial: null, descripcion: null, textoDocumento: null })).toBe('');
  });
});

describe('textoDocumentoDe', () => {
  it('saca textoDocumento de un extraccionRaw', () => {
    expect(textoDocumentoDe({ textoDocumento: 'hola mundo', total: 1 })).toBe('hola mundo');
  });
  it('extraccionRaw viejo (sin el campo) o ausente → null', () => {
    expect(textoDocumentoDe({ total: 1 })).toBeNull();
    expect(textoDocumentoDe(null)).toBeNull();
  });
});

describe('extraccionSchema — textoDocumento', () => {
  it('acepta el campo y defaultea a null', () => {
    const con = extraccionSchema.parse({ tipoComprobante: 'RECIBO', total: 100, moneda: 'USD', textoDocumento: 'Receipt…' });
    expect(con.textoDocumento).toBe('Receipt…');
    const sin = extraccionSchema.parse({ tipoComprobante: 'RECIBO', total: 100, moneda: 'USD' });
    expect(sin.textoDocumento).toBeNull();
  });
});

describe('ocrParaRegla — texto del documento para el pop-up', () => {
  it('expone textoDocumento aparte (no mezclado en los chips de textoMatching)', () => {
    const r = ocrParaRegla({
      extraccionRaw: { concepto: 'Max plan', textoDocumento: 'Bill to EWWO apalmieri@ewwoconsulting.com' },
      descripcion: 'Max plan',
      razonSocialContraparte: 'Anthropic, PBC',
    });
    expect(r.textoDocumento).toBe('Bill to EWWO apalmieri@ewwoconsulting.com');
    expect(r.textoMatching).toBe('Anthropic, PBC Max plan');
  });
  it('sin campo → textoDocumento null', () => {
    const r = ocrParaRegla({ extraccionRaw: { concepto: 'x' }, descripcion: null, razonSocialContraparte: null });
    expect(r.textoDocumento).toBeNull();
  });
  it('textoDocumento no aparece duplicado entre los campos extraídos', () => {
    const r = ocrParaRegla({
      extraccionRaw: { concepto: 'Max plan', textoDocumento: 'texto largo del documento' },
      descripcion: null,
      razonSocialContraparte: null,
    });
    expect(r.campos.some((c) => c.valor === 'texto largo del documento')).toBe(false);
  });
});
