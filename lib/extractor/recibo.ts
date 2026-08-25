import Anthropic from '@anthropic-ai/sdk';
import { reciboExtraccionSchema, reciboExtraccionJsonSchema, type ReciboExtraccion } from './recibo-schema';
import type { UsoTokens } from './index';

// Extractor de recibos de sueldo: recibe UNA página (texto si el PDF tiene capa
// de texto; si no, el PDF entero como document block con instrucción de leer
// solo esa página). Mismo patrón de tool forzado que AnthropicExtractor.

export type ReciboExtractorInput = {
  texto: string | null; // texto de la página, si el PDF tiene capa de texto
  buffer: Buffer; // PDF completo (fallback visión)
  mime: string;
  pagina: number; // 1-based
};

export type ReciboExtractorResult = { extraccion: ReciboExtraccion; uso: UsoTokens | null };

export interface ReciboExtractor {
  extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult>;
}

const SYSTEM_PROMPT = `Sos un extractor de datos de recibos de sueldo argentinos. Cada empresa usa un modelo de recibo distinto: no asumas un layout fijo.
Reglas estrictas:
- NO inventes datos: ante la duda, devolvé null en ese campo.
- Los importes van como números positivos.
- CUIL: solo los 11 dígitos, sin guiones.
- Fechas en formato YYYY-MM-DD.
- "periodoAnio"/"periodoMes": del período ABONADO (p.ej. "Mensual - Agosto 2026" → 2026 / 8).
- "tipo": SAC si es aguinaldo (1ra o 2da cuota), VACACIONES si es liquidación de vacaciones, LIQUIDACION_FINAL si es liquidación final; MENSUAL para el sueldo del mes.
- Cargá TODOS los conceptos con su naturaleza: REMUNERATIVO (haberes), RETENCION (deducciones al empleado: jubilación, obra social, adelantos, retención 4ta categoría), NO_REMUNERATIVO, CONTRIBUCION_EMPLEADOR (cargas patronales, ART, seguro colectivo).
- "costoTotalEmpleador": SOLO si el recibo lo imprime explícitamente; si no figura, null (el sistema lo calcula).
- Completá "confianza" con un valor 0..1 por campo extraído.`;

class AnthropicReciboExtractor implements ReciboExtractor {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';

  async extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.texto && input.texto.trim().length > 100) {
      content.push({ type: 'text', text: `Texto extraído de la página ${input.pagina} del PDF de recibos:\n\n${input.texto.slice(0, 50000)}` });
      content.push({ type: 'text', text: 'Extraé los datos del recibo usando la herramienta.' });
    } else {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
      });
      content.push({
        type: 'text',
        text: `El PDF contiene un recibo por página. Extraé usando la herramienta SOLO los datos del recibo de la página ${input.pagina}.`,
      });
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ name: 'registrar_recibo', description: 'Registra los datos extraídos del recibo de sueldo', input_schema: reciboExtraccionJsonSchema as never }],
      tool_choice: { type: 'tool', name: 'registrar_recibo' },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('El modelo no devolvió la extracción estructurada');

    const u = response.usage;
    return {
      extraccion: reciboExtraccionSchema.parse(toolUse.input),
      uso: {
        entrada: u.input_tokens ?? 0,
        salida: u.output_tokens ?? 0,
        cacheCreacion: u.cache_creation_input_tokens ?? 0,
        cacheLectura: u.cache_read_input_tokens ?? 0,
        modelo: this.model,
      },
    };
  }
}

/** Mock determinístico para dev/tests sin API key: un empleado por página. */
class MockReciboExtractor implements ReciboExtractor {
  async extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult> {
    const n = input.pagina;
    const bruto = 1_000_000 + n * 10_000;
    return {
      extraccion: reciboExtraccionSchema.parse({
        nombre: `EMPLEADO MOCK ${n}`,
        cuil: `2000000${String(n).padStart(3, '0')}0`,
        legajo: String(n).padStart(8, '0'),
        categoriaLaboral: 'MOCK',
        sector: null,
        fechaIngreso: '2020-01-01',
        periodoAnio: 2026,
        periodoMes: 8,
        tipo: 'MENSUAL',
        conceptos: [{ concepto: 'Sueldo Mensual', unidad: '31', importe: bruto, naturaleza: 'REMUNERATIVO' }],
        brutoRemunerativo: bruto,
        noRemunerativo: 0,
        retenciones: bruto * 0.17,
        sueldoNeto: bruto * 0.83,
        contribucionesEmpleador: bruto * 0.26,
        costoTotalEmpleador: bruto * 1.26,
        confianza: { cuil: 1 },
      }),
      uso: null,
    };
  }
}

/** EXTRACTOR_MODE=mock (default) | real — misma llave que el extractor de comprobantes. */
export function getReciboExtractor(): ReciboExtractor {
  const mode = process.env.EXTRACTOR_MODE ?? 'mock';
  if (mode === 'real') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[recibo-extractor] EXTRACTOR_MODE=real sin ANTHROPIC_API_KEY: usando mock.');
      return new MockReciboExtractor();
    }
    return new AnthropicReciboExtractor();
  }
  return new MockReciboExtractor();
}
