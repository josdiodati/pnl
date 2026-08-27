import Anthropic from '@anthropic-ai/sdk';
import { resumenExtraccionSchema, resumenExtraccionJsonSchema, type ResumenExtraccion } from './resumen-schema';
import type { UsoTokens } from './index';

export type ResumenExtractorInput = { texto: string | null; buffer: Buffer; mime: string };
export type ResumenExtractorResult = { extraccion: ResumenExtraccion; uso: UsoTokens | null };

export interface ResumenExtractor {
  extract(input: ResumenExtractorInput): Promise<ResumenExtractorResult>;
}

const SYSTEM_PROMPT = `Sos un extractor de RESÚMENES bancarios y de tarjeta de crédito argentinos. Cada banco/tarjeta usa un formato distinto: no asumas un layout fijo.
Reglas estrictas:
- Extraé TODAS las líneas de movimientos/consumos, incluidas comisiones, impuestos (Sircreb, imp. débito/créditos, percepciones, DB IVA), seguros y débitos automáticos.
- NO extraigas como líneas: encabezados, subtotales, saldos iniciales/finales, límites de compra ni leyendas legales.
- Los importes van FIRMADOS: débitos/consumos NEGATIVOS; créditos/pagos/rendimientos POSITIVOS.
- Consumos en moneda extranjera: si el resumen no muestra el importe en pesos, "monto" va null y "montoOrigen" lleva el importe en la moneda origen (firmado).
- Si el PDF consolida VARIAS cuentas (ej. dos cajas en pesos y una en dólares), completá "cuenta" en cada línea con la cuenta a la que pertenece.
- Si la tarjeta agrupa consumos por titular ("TOTAL CONSUMOS DE ..."), completá "titular" en cada consumo con ese nombre.
- Fechas en formato YYYY-MM-DD (inferí el año del período del resumen).
- "periodoAnio"/"periodoMes": el mes al que corresponden los movimientos (no la fecha de emisión).
- "totalDeclarado": el saldo/total del resumen si figura (firmado), para control de completitud.
- Los pagos del resumen anterior ("SU PAGO EN PESOS") SÍ van como líneas (positivas): el usuario las ignora en la conciliación.`;

class AnthropicResumenExtractor implements ResumenExtractor {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';

  async extract(input: ResumenExtractorInput): Promise<ResumenExtractorResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.texto && input.texto.trim().length > 200) {
      content.push({ type: 'text', text: `Texto extraído del PDF del resumen:\n\n${input.texto.slice(0, 100000)}` });
    } else {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') } });
    }
    content.push({ type: 'text', text: 'Extraé el resumen completo usando la herramienta.' });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384, // los resúmenes traen muchas líneas
      system: SYSTEM_PROMPT,
      tools: [{ name: 'registrar_resumen', description: 'Registra el resumen extraído', input_schema: resumenExtraccionJsonSchema as never }],
      tool_choice: { type: 'tool', name: 'registrar_resumen' },
      messages: [{ role: 'user', content }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('El modelo no devolvió la extracción estructurada');
    const u = response.usage;
    return {
      extraccion: resumenExtraccionSchema.parse(toolUse.input),
      uso: { entrada: u.input_tokens ?? 0, salida: u.output_tokens ?? 0, cacheCreacion: u.cache_creation_input_tokens ?? 0, cacheLectura: u.cache_read_input_tokens ?? 0, modelo: this.model },
    };
  }
}

/** Mock determinístico para dev/tests sin API key. */
class MockResumenExtractor implements ResumenExtractor {
  async extract(): Promise<ResumenExtractorResult> {
    return {
      extraccion: resumenExtraccionSchema.parse({
        tipo: 'TARJETA',
        emisor: 'Tarjeta Mock',
        periodoAnio: 2026,
        periodoMes: 8,
        totalDeclarado: -150000,
        lineas: [
          { fecha: '2026-08-05', descriptor: 'SERVICIO MOCK SA', monto: -100000, moneda: 'ARS', montoOrigen: null, cuotas: null, cuenta: null, titular: null },
          { fecha: '2026-08-10', descriptor: 'MOCK CLOUD USD', monto: null, moneda: 'USD', montoOrigen: -50, cuotas: null, cuenta: null, titular: null },
          { fecha: '2026-08-15', descriptor: 'COMISION MANTENIMIENTO', monto: -50000, moneda: 'ARS', montoOrigen: null, cuotas: null, cuenta: null, titular: null },
        ],
      }),
      uso: null,
    };
  }
}

export function getResumenExtractor(): ResumenExtractor {
  const mode = process.env.EXTRACTOR_MODE ?? 'mock';
  if (mode === 'real') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[resumen-extractor] EXTRACTOR_MODE=real sin ANTHROPIC_API_KEY: usando mock.');
      return new MockResumenExtractor();
    }
    return new AnthropicResumenExtractor();
  }
  return new MockResumenExtractor();
}
