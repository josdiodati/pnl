// Documentos que entran a Carga pero NO son comprobantes (presupuestos,
// remitos, contratos, publicidad…). Se detectan en dos puntos:
//   1. prefiltro barato (Haiku) antes de gastar la extracción: sólo descarta
//      si está seguro (UMBRAL_PREFILTRO);
//   2. la misma extracción (campo tipoDocumento), salvo que el PDF tenga QR
//      de AFIP (eso prueba que es un comprobante).
// Quedan en estado NO_COMPROBANTE, fuera de las colas, y se borran solos a
// los DIAS_RETENCION_NO_COMPROBANTE días (movimiento y archivo). Si el modelo
// se equivocó, "Es un comprobante" lo reprocesa sin estos filtros.

export const TIPOS_DOCUMENTO = [
  'COMPROBANTE',
  'PRESUPUESTO',
  'REMITO',
  'CONTRATO',
  'RESUMEN_BANCARIO',
  'PUBLICIDAD',
  'OTRO',
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumento, string> = {
  COMPROBANTE: 'Comprobante',
  PRESUPUESTO: 'Presupuesto / cotización',
  REMITO: 'Remito',
  CONTRATO: 'Contrato',
  RESUMEN_BANCARIO: 'Resumen bancario o de tarjeta (va en Resúmenes)',
  PUBLICIDAD: 'Publicidad / newsletter',
  OTRO: 'Otro documento',
};

/** Etiqueta del tipo guardado en los flags de un NO_COMPROBANTE. */
export function etiquetaTipoDocumento(flags: unknown): string {
  const t = (flags as { tipoDocumento?: string } | null)?.tipoDocumento as TipoDocumento | undefined;
  return (t && TIPO_DOCUMENTO_LABEL[t]) || 'No es comprobante';
}

export type ClasificacionDocumento = { tipoDocumento: TipoDocumento; confianza: number; motivo: string };

export const UMBRAL_PREFILTRO = 0.85;
export const DIAS_RETENCION_NO_COMPROBANTE = 7;

export function descartarPorPrefiltro(c: ClasificacionDocumento | null): boolean {
  return Boolean(c && c.tipoDocumento !== 'COMPROBANTE' && c.confianza >= UMBRAL_PREFILTRO);
}

export function descartarPorExtraccion(tipoDocumento: TipoDocumento, hayQrAfip: boolean): boolean {
  return tipoDocumento !== 'COMPROBANTE' && !hayQrAfip;
}

export function fechaBorradoNoComprobante(desde: Date): Date {
  return new Date(desde.getTime() + DIAS_RETENCION_NO_COMPROBANTE * 86_400_000);
}
