import type { Extraccion } from './schema';
import { MockExtractor } from './mock';
import { AnthropicExtractor } from './anthropic';

export type ExtractorInput = {
  buffer: Buffer;
  mime: string;
  filename: string;
  /** Recurring corrections stored on the Contraparte, injected into the prompt. */
  instrucciones?: string | null;
};

/** Token usage of one LLM extraction call, for per-comprobante cost monitoring. */
export type UsoTokens = {
  entrada: number; // input_tokens
  salida: number; // output_tokens
  cacheCreacion: number; // cache_creation_input_tokens
  cacheLectura: number; // cache_read_input_tokens
  modelo: string;
};

export type ExtractorResult = {
  extraccion: Extraccion;
  /** null when no tokens were consumed (e.g. mock extractor). */
  uso: UsoTokens | null;
};

export interface DocumentExtractor {
  extract(input: ExtractorInput): Promise<ExtractorResult>;
}

/**
 * EXTRACTOR_MODE=mock (default) | real. Real mode requires ANTHROPIC_API_KEY;
 * without it we fall back to mock so the app never depends on a credential.
 */
export function getExtractor(): DocumentExtractor {
  const mode = process.env.EXTRACTOR_MODE ?? 'mock';
  if (mode === 'real') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[extractor] EXTRACTOR_MODE=real sin ANTHROPIC_API_KEY: usando mock.');
      return new MockExtractor();
    }
    return new AnthropicExtractor();
  }
  return new MockExtractor();
}
