import { describe, it, expect } from 'vitest';
import { ocrParaRegla, opcionesPalabraClave } from '@/lib/reglas/ocr-para-regla';
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
    expect(ocrParaRegla({ extraccionRaw: null, descripcion: null, razonSocialContraparte: null })).toEqual({ textoMatching: '', textoDocumento: null, campos: [] });
  });
});

describe('opcionesPalabraClave — chips del pop-up OCR', () => {
  const texto = 'EWWO CONSULTING S.R.L. Servicios PM y Movilidad PM - Período 01/08/2026 al 31/08/2026';

  it('ofrece frases de dos palabras adyacentes («Servicios PM», «Movilidad PM»)', () => {
    const o = opcionesPalabraClave(texto);
    expect(o).toContain('Servicios PM');
    expect(o).toContain('Movilidad PM');
    expect(o).toContain('EWWO CONSULTING');
  });

  it('las frases no cruzan palabras vacías ni incluyen números/fechas', () => {
    const o = opcionesPalabraClave(texto);
    expect(o).not.toContain('PM y');
    expect(o).not.toContain('y Movilidad');
    expect(o).not.toContain('al 31/08/2026');
    expect(o).not.toContain('Período 01/08/2026');
  });

  it('palabras sueltas desde 2 caracteres («PM» aparece), sin palabras vacías', () => {
    const o = opcionesPalabraClave(texto);
    expect(o).toContain('PM');
    expect(o).toContain('Servicios');
    expect(o).not.toContain('y');
    expect(o).not.toContain('al');
  });

  it('sin duplicados y las frases van antes que las palabras sueltas', () => {
    const o = opcionesPalabraClave(texto);
    expect(new Set(o).size).toBe(o.length);
    expect(o.indexOf('Servicios PM')).toBeLessThan(o.indexOf('Servicios'));
  });

  it('texto vacío → sin opciones', () => {
    expect(opcionesPalabraClave('')).toEqual([]);
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
