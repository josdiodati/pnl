import { z } from 'zod';

// Extracción LLM de un resumen de tarjeta o banco. Agnóstico del formato:
// cada emisor imprime distinto (BBVA consolida varias cuentas en un PDF,
// las tarjetas agrupan por titular, los consumos USD no traen pesos).

export const lineaResumenSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  descriptor: z.string(),
  /** FIRMADO en ARS: débito/consumo NEGATIVO, crédito/pago POSITIVO. null = consumo en moneda extranjera sin importe en pesos. */
  monto: z.number().nullable().default(null),
  moneda: z.enum(['ARS', 'USD', 'EUR', 'OTRA']).default('ARS'),
  /** Importe FIRMADO en la moneda origen cuando el resumen muestra ambos. */
  montoOrigen: z.number().nullable().default(null),
  cuotas: z.string().nullable().default(null),
  cuenta: z.string().nullable().default(null),
  titular: z.string().nullable().default(null),
});

export const resumenExtraccionSchema = z.object({
  tipo: z.enum(['TARJETA', 'BANCO']),
  emisor: z.string(),
  periodoAnio: z.number().int(),
  periodoMes: z.number().int().min(1).max(12),
  fechaCierre: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  totalDeclarado: z.number().nullable().default(null),
  lineas: z.array(lineaResumenSchema).default([]),
  observaciones: z.string().nullable().default(null),
});

export type ResumenExtraccion = z.infer<typeof resumenExtraccionSchema>;
export type LineaExtraida = z.infer<typeof lineaResumenSchema>;

export const resumenExtraccionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo: { type: 'string', enum: ['TARJETA', 'BANCO'] },
    emisor: { type: 'string', description: 'Banco/tarjeta y cuenta, ej. "Visa Business BBVA", "Santander CC $ 000-039152/2"' },
    periodoAnio: { type: 'integer' },
    periodoMes: { type: 'integer', description: '1-12, período al que corresponde el resumen' },
    fechaCierre: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    totalDeclarado: { type: ['number', 'null'], description: 'Saldo/total que imprime el resumen (firmado), para control de completitud' },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fecha: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          descriptor: { type: 'string', description: 'La descripción del movimiento TAL CUAL figura' },
          monto: { type: ['number', 'null'], description: 'Importe en PESOS, FIRMADO: débitos/consumos NEGATIVOS, créditos/pagos POSITIVOS. null si el consumo es en moneda extranjera y el resumen no muestra pesos' },
          moneda: { type: 'string', enum: ['ARS', 'USD', 'EUR', 'OTRA'] },
          montoOrigen: { type: ['number', 'null'], description: 'Importe FIRMADO en la moneda origen cuando el resumen muestra ambas columnas' },
          cuotas: { type: ['string', 'null'], description: 'ej. "3/6" si es un consumo en cuotas' },
          cuenta: { type: ['string', 'null'], description: 'A qué cuenta/tarjeta del PDF pertenece la línea (los resúmenes de banco pueden consolidar varias cuentas)' },
          titular: { type: ['string', 'null'], description: 'Titular de la tarjeta si el resumen agrupa consumos por titular' },
        },
        required: ['descriptor', 'monto', 'moneda'],
      },
    },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['tipo', 'emisor', 'periodoAnio', 'periodoMes'],
} as const;
