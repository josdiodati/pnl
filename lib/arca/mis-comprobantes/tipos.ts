// Una fila del reporte "Mis Comprobantes" de ARCA, ya normalizada (mismo
// resultado venga del CSV exportado o del JSON posicional del portal).

export type OrigenMisComprobantes = 'EMITIDO' | 'RECIBIDO';

export type AlicuotaIva = { iva?: number; neto?: number };

export type FilaMisComprobantes = {
  fechaEmision: string; // yyyy-mm-dd
  tipoComprobante: number; // código ARCA
  puntoVenta: number;
  numeroDesde: number;
  numeroHasta: number;
  codigoAutorizacion: string | null;
  /** Emisor en recibidos, receptor en emitidos. */
  tipoDocContraparte: number | null;
  nroDocContraparte: string; // '' si no viene (consumidor final)
  denominacionContraparte: string | null;
  /** Sólo en recibidos: el CUIT que figura como receptor (debe ser la empresa). */
  nroDocReceptor: string | null;
  tipoCambio: number | null;
  moneda: string | null;
  ivaPorAlicuota: Record<string, AlicuotaIva>;
  netoGravadoTotal: number | null;
  netoNoGravado: number | null;
  exentas: number | null;
  otrosTributos: number | null;
  totalIva: number | null;
  importeTotal: number | null;
};

/** Alícuotas en el orden en que el reporte las imprime. */
export const ALICUOTAS = ['2.5', '5', '10.5', '21', '27'] as const;
