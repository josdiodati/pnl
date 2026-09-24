// Catálogo de instrumentos de cobro: sin dependencias de servidor (lo usan
// componentes cliente y el matching).

export const INSTRUMENTOS = ['TRANSFERENCIA', 'CHEQUE', 'ECHEQ', 'EFECTIVO', 'RETENCION', 'NOTA_CREDITO', 'OTRO'] as const;
export type Instrumento = (typeof INSTRUMENTOS)[number];

export const INSTRUMENTO_LABEL: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia',
  CHEQUE: 'Cheque',
  ECHEQ: 'E-cheq',
  EFECTIVO: 'Efectivo',
  RETENCION: 'Retención',
  NOTA_CREDITO: 'Nota de crédito',
  OTRO: 'Otro',
};

/** Instrumentos que pasan por el banco (se concilian con el resumen y entran en la proyección). */
export const INSTRUMENTOS_BANCARIOS = new Set(['TRANSFERENCIA', 'CHEQUE', 'ECHEQ', 'OTRO']);
export const ES_CHEQUE = new Set(['CHEQUE', 'ECHEQ']);

export const ESTADO_COBRO_LABEL: Record<string, string> = { EN_CARTERA: 'En cartera', ACREDITADO: 'Acreditado', RECHAZADO: 'Rechazado' };
