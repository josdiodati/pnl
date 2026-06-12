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
  puntoVenta: z.string().nullable(),
  numero: z.string().nullable(),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  cuitEmisor: z.string().nullable(),
  razonSocialEmisor: z.string().nullable(),
  netoGravado: z.number().nullable(),
  iva21: z.number().nullable(),
  iva105: z.number().nullable(),
  iva27: z.number().nullable(),
  percepcionesIva: z.number().nullable(),
  percepcionesIibb: z.number().nullable(),
  otrosTributos: z.number().nullable(),
  noGravadoExento: z.number().nullable(),
  total: z.number().nullable(),
  moneda: z.enum(['ARS', 'USD', 'EUR', 'OTRA']).default('ARS'),
  cae: z.string().nullable(),
  vencimientoCae: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
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
    confianza: { type: 'object', additionalProperties: { type: 'number' } },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['tipoComprobante', 'total', 'moneda'],
} as const;
