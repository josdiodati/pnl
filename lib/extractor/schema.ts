import { z } from 'zod';

// Strict JSON output schema for the LLM extraction (doc 04).

export const TIPOS_COMPROBANTE = [
  'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_E',
  'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C',
  'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C',
  'TICKET', 'RECIBO', 'OTRO',
] as const;

export const extraccionSchema = z.object({
  tipoComprobante: z.enum(TIPOS_COMPROBANTE).nullable(),
  puntoVenta: z.string().nullable().default(null),
  numero: z.string().nullable().default(null),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  cuitEmisor: z.string().nullable().default(null),
  razonSocialEmisor: z.string().nullable().default(null),
  netoGravado: z.number().nullable().default(null),
  iva21: z.number().nullable().default(null),
  iva105: z.number().nullable().default(null),
  iva27: z.number().nullable().default(null),
  percepcionesIva: z.number().nullable().default(null),
  percepcionesIibb: z.number().nullable().default(null),
  otrosTributos: z.number().nullable().default(null),
  noGravadoExento: z.number().nullable().default(null),
  total: z.number().nullable(),
  moneda: z.enum(['ARS', 'USD', 'EUR', 'OTRA']).default('ARS'),
  cae: z.string().nullable().default(null),
  vencimientoCae: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  cuitReceptor: z.string().nullable().default(null),
  razonSocialReceptor: z.string().nullable().default(null),
  esComprobanteFiscalArg: z.boolean().default(false),
  confianza: z.record(z.number()).default({}),
  observaciones: z.string().nullable().default(null),
});

export type Extraccion = z.infer<typeof extraccionSchema>;

// JSON Schema handed to the LLM as a forced tool input (anthropic tool use).
export const extraccionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipoComprobante: { type: ['string', 'null'], enum: [...TIPOS_COMPROBANTE, null] as any },
    puntoVenta: { type: ['string', 'null'] },
    numero: { type: ['string', 'null'] },
    fechaEmision: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    cuitEmisor: { type: ['string', 'null'], description: 'Solo dígitos, 11' },
    razonSocialEmisor: { type: ['string', 'null'] },
    netoGravado: { type: ['number', 'null'] },
    iva21: { type: ['number', 'null'] },
    iva105: { type: ['number', 'null'] },
    iva27: { type: ['number', 'null'] },
    percepcionesIva: { type: ['number', 'null'] },
    percepcionesIibb: { type: ['number', 'null'] },
    otrosTributos: { type: ['number', 'null'] },
    noGravadoExento: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
    moneda: { type: 'string', enum: ['ARS', 'USD', 'EUR', 'OTRA'] },
    cae: { type: ['string', 'null'] },
    vencimientoCae: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    cuitReceptor: { type: ['string', 'null'], description: 'CUIT del receptor, solo dígitos' },
    razonSocialReceptor: { type: ['string', 'null'] },
    esComprobanteFiscalArg: {
      type: 'boolean',
      description: 'true si es comprobante fiscal argentino (factura/NC/ND/ticket con CAE); false si es invoice extranjero o no fiscal (AWS, Claude, Google, etc.)',
    },
    confianza: { type: 'object', additionalProperties: { type: 'number' } },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['tipoComprobante', 'total', 'moneda', 'esComprobanteFiscalArg'],
} as const;
