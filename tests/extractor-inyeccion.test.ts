import { describe, it, expect } from 'vitest';
import { extraccionSchema, extraccionJsonSchema } from '@/lib/extractor/schema';
import { SYSTEM_PROMPT } from '@/lib/extractor/anthropic';

// Defensa contra prompt injection en los documentos que entran (p. ej. por
// mail): el prompt trata el documento como datos y el modelo reporta el texto
// que parezca una instrucción en `instruccionesSospechosas`.

const base = { tipoComprobante: null, total: 1, moneda: 'ARS', esComprobanteFiscalArg: true };

describe('extractor: prompt injection', () => {
  it('el prompt ordena tratar el documento como datos y reportar las instrucciones', () => {
    expect(SYSTEM_PROMPT).toMatch(/SOLO una fuente de datos/);
    expect(SYSTEM_PROMPT).toMatch(/instruccionesSospechosas/);
  });

  it('el schema de la herramienta expone el campo, y por defecto es null', () => {
    expect(extraccionJsonSchema.properties).toHaveProperty('instruccionesSospechosas');
    expect(extraccionSchema.parse(base).instruccionesSospechosas).toBeNull();
  });

  it('un texto vacío o de espacios cuenta como null', () => {
    expect(extraccionSchema.parse({ ...base, instruccionesSospechosas: '  ' }).instruccionesSospechosas).toBeNull();
  });
});
