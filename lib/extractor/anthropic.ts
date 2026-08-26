import Anthropic from '@anthropic-ai/sdk';
import { extraccionSchema, extraccionJsonSchema } from './schema';
import type { DocumentExtractor, ExtractorInput, ExtractorResult } from './index';

// Real extractor (EXTRACTOR_MODE=real + ANTHROPIC_API_KEY). Strategy per spec:
// - PDFs with a text layer (electronic invoices): send extracted TEXT (cheaper
//   and more precise than vision).
// - Scanned PDFs: send the PDF as a document block (vision).
// - Images: send as image block.
// Output is forced through a tool with a strict JSON schema.

const SYSTEM_PROMPT = `Sos un extractor de datos de comprobantes fiscales argentinos (facturas, notas de crédito/débito, tickets, recibos).
Reglas estrictas:
- NO inventes datos: ante la duda, devolvé null en ese campo.
- Los importes van como números positivos, incluso en notas de crédito/débito (el sistema deriva el signo después).
- Si la factura de servicios tiene dos vencimientos con importes distintos, tomá SIEMPRE el importe del PRIMER vencimiento.
- CUIT: solo los 11 dígitos, sin guiones.
- Fechas en formato YYYY-MM-DD.
- Completá "confianza" con un valor 0..1 por cada campo extraído (1 = totalmente legible y sin ambigüedad).
- "puntoVenta" y "numero" como strings con sus ceros a la izquierda si los tiene.
- Extraé también el RECEPTOR del comprobante (cuitReceptor, razonSocialReceptor): es a nombre de quién se emite.
- OJO con los layouts donde emisor y receptor están en recuadros separados: el EMISOR es quien emite y cobra (su CUIT acompaña a su razón social, logo, IIBB e inicio de actividades, normalmente en el encabezado); el RECEPTOR/cliente aparece bajo etiquetas como "Señores", "Cliente", "Apellido y Nombre / Razón Social". Pareá cada CUIT con la razón social de SU MISMO recuadro — nunca cruces el CUIT de uno con el nombre del otro. Verificación: si la razón social que pusiste como emisora no es la del membrete/logo del comprobante, lo tenés cruzado.
- Marcá "esComprobanteFiscalArg" en true SOLO si es un comprobante fiscal argentino (factura/nota de crédito/débito/ticket con CAE). Para invoices de servicios extranjeros que no emiten comprobante fiscal argentino (AWS, Anthropic/Claude, Google, etc.), poné false.`;

export class AnthropicExtractor implements DocumentExtractor {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';

  async extract(input: ExtractorInput): Promise<ExtractorResult> {
    const content: Anthropic.ContentBlockParam[] = [];

    if (input.mime === 'application/pdf') {
      const texto = await this.tryPdfText(input.buffer);
      if (texto && texto.trim().length > 100) {
        content.push({ type: 'text', text: `Texto extraído del PDF del comprobante:\n\n${texto.slice(0, 50000)}` });
      } else {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
        });
      }
    } else {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mime as 'image/jpeg' | 'image/png' | 'image/webp',
          data: input.buffer.toString('base64'),
        },
      });
    }

    let instrucciones = 'Extraé los datos del comprobante usando la herramienta.';
    if (input.instrucciones) {
      // Per-supplier corrections learned by validators (doc 04 "aprendizaje sin reentrenar")
      instrucciones += `\n\nInstrucciones específicas para este emisor (correcciones recurrentes):\n${input.instrucciones}`;
    }
    content.push({ type: 'text', text: instrucciones });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'registrar_extraccion',
          description: 'Registra los datos extraídos del comprobante',
          input_schema: extraccionJsonSchema as never,
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_extraccion' },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('El modelo no devolvió la extracción estructurada');
    }

    const u = response.usage;
    return {
      extraccion: extraccionSchema.parse(toolUse.input),
      uso: {
        entrada: u.input_tokens ?? 0,
        salida: u.output_tokens ?? 0,
        cacheCreacion: u.cache_creation_input_tokens ?? 0,
        cacheLectura: u.cache_read_input_tokens ?? 0,
        modelo: this.model,
      },
    };
  }

  private async tryPdfText(buffer: Buffer): Promise<string | null> {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(doc, { mergePages: true });
      return text;
    } catch {
      return null;
    }
  }
}
