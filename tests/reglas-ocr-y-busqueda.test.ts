import { describe, it, expect } from 'vitest';
import { ocrParaRegla } from '@/lib/reglas/ocr-para-regla';
import { buildWhereMovimientos } from '@/lib/movimientos/query';

describe('ocrParaRegla', () => {
  it('arma el texto de matching como la regla (razón social + descripción) y lista los campos de texto primero', () => {
    const r = ocrParaRegla({
      extraccionRaw: { total: 1234.5, concepto: 'Servicio internet fibra', razonSocialEmisor: 'TELECOM SA', confianza: { total: 0.9 }, esComprobanteFiscalArg: true, cae: null },
      descripcion: 'Servicio internet fibra',
      razonSocialContraparte: 'Telecom Argentina',
    });
    expect(r.textoMatching).toBe('Telecom Argentina Servicio internet fibra');
    expect(r.campos[0]).toEqual({ label: 'Concepto', valor: 'Servicio internet fibra' });
    expect(r.campos.map((c) => c.label)).toContain('Total');
    expect(r.campos.some((c) => c.label === 'confianza' || c.label === 'esComprobanteFiscalArg' || c.label === 'CAE')).toBe(false);
  });

  it('tolera extracción ausente', () => {
    expect(ocrParaRegla({ extraccionRaw: null, descripcion: null, razonSocialContraparte: null })).toEqual({ textoMatching: '', campos: [] });
  });
});

describe('buildWhereMovimientos — búsqueda libre', () => {
  const opts = { esValidador: true, usuarioId: 'u1' };
  it('q arma un OR insensible sobre descripción, número, CUIT, archivo y contraparte', () => {
    const w = buildWhereMovimientos({ q: '  telecom ' }, opts);
    expect(w.OR).toHaveLength(6);
    expect(w.OR).toContainEqual({ descripcion: { contains: 'telecom', mode: 'insensitive' } });
    expect(w.OR).toContainEqual({ contraparte: { razonSocial: { contains: 'telecom', mode: 'insensitive' } } });
    expect(w.estado).toBeDefined(); // el libro sigue acotado a asignados
  });
  it('q vacío no filtra', () => {
    expect(buildWhereMovimientos({ q: '   ' }, opts).OR).toBeUndefined();
  });
});
