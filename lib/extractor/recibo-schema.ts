import { z } from 'zod';

// Schema estricto de la extracción LLM de UN recibo de sueldo (una página del
// PDF multi-recibo). Agnóstico del modelo de recibo: los conceptos son una
// lista flexible con naturaleza, no un formulario fijo.

export const TIPOS_RECIBO = ['MENSUAL', 'SAC', 'VACACIONES', 'LIQUIDACION_FINAL', 'OTRO'] as const;
export const NATURALEZAS_CONCEPTO = ['REMUNERATIVO', 'RETENCION', 'NO_REMUNERATIVO', 'CONTRIBUCION_EMPLEADOR'] as const;

export const reciboExtraccionSchema = z.object({
  nombre: z.string().nullable(),
  cuil: z.string().nullable(),
  legajo: z.string().nullable().default(null),
  categoriaLaboral: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  periodoAnio: z.number().int().nullable(),
  periodoMes: z.number().int().min(1).max(12).nullable(),
  tipo: z.enum(TIPOS_RECIBO).default('MENSUAL'),
  conceptos: z
    .array(
      z.object({
        concepto: z.string(),
        unidad: z.string().nullable().default(null),
        importe: z.number(),
        naturaleza: z.enum(NATURALEZAS_CONCEPTO),
      }),
    )
    .default([]),
  brutoRemunerativo: z.number().nullable().default(null),
  noRemunerativo: z.number().nullable().default(null),
  retenciones: z.number().nullable().default(null),
  sueldoNeto: z.number().nullable().default(null),
  contribucionesEmpleador: z.number().nullable().default(null),
  costoTotalEmpleador: z.number().nullable().default(null),
  confianza: z.record(z.number()).default({}),
  observaciones: z.string().nullable().default(null),
});

export type ReciboExtraccion = z.infer<typeof reciboExtraccionSchema>;

// JSON Schema para el tool forzado (patrón extraccionJsonSchema).
export const reciboExtraccionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nombre: { type: ['string', 'null'], description: 'Apellido y nombre del empleado' },
    cuil: { type: ['string', 'null'], description: 'CUIL, solo 11 dígitos sin guiones' },
    legajo: { type: ['string', 'null'] },
    categoriaLaboral: { type: ['string', 'null'] },
    sector: { type: ['string', 'null'], description: 'Sector o tarea desempeñada' },
    fechaIngreso: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    periodoAnio: { type: ['integer', 'null'], description: 'Año del período abonado' },
    periodoMes: { type: ['integer', 'null'], description: 'Mes del período abonado (1-12)' },
    tipo: { type: 'string', enum: [...TIPOS_RECIBO] },
    conceptos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          concepto: { type: 'string' },
          unidad: { type: ['string', 'null'], description: 'Unidad/cantidad/porcentaje tal como figura' },
          importe: { type: 'number' },
          naturaleza: { type: 'string', enum: [...NATURALEZAS_CONCEPTO] },
        },
        required: ['concepto', 'importe', 'naturaleza'],
      },
    },
    brutoRemunerativo: { type: ['number', 'null'], description: 'Total remunerativo del recibo' },
    noRemunerativo: { type: ['number', 'null'], description: 'Total no remunerativo' },
    retenciones: { type: ['number', 'null'], description: 'Total de retenciones/deducciones del empleado' },
    sueldoNeto: { type: ['number', 'null'] },
    contribucionesEmpleador: { type: ['number', 'null'], description: 'Subtotal de contribuciones del empleador (cargas patronales + ART + SCVO)' },
    costoTotalEmpleador: { type: ['number', 'null'], description: 'COSTO TOTAL EMPLEADOR si el recibo lo imprime; null si no figura' },
    confianza: { type: 'object', additionalProperties: { type: 'number' } },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['nombre', 'cuil', 'periodoAnio', 'periodoMes', 'tipo'],
} as const;
