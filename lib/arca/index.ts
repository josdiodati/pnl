import { ArcaConstatacionMock } from './mock';
import { ArcaConstatacionWs } from './ws';

export type ArcaInput = {
  cuitEmisor: string;
  tipoComprobante: string; // app-level type, mapped to ARCA numeric code
  puntoVenta: number;
  numero: number;
  fecha: string; // YYYY-MM-DD
  importeTotal: number;
  cae: string;
  cuitReceptor?: string;
};

export type ArcaResultado = {
  estado: 'VALIDO' | 'INVALIDO' | 'ERROR_CONSULTA';
  detalle?: string;
  consultadoAt: Date;
};

export interface ArcaConstatacion {
  constatar(input: ArcaInput): Promise<ArcaResultado>;
}

// Mapping of app voucher types to ARCA (ex AFIP) comprobante codes.
export const CODIGO_ARCA: Record<string, number> = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
  FACTURA_E: 19,
};

/** ARCA_MODE=mock (default) | ws. ws degrades gracefully without certificates. */
export function getArca(): ArcaConstatacion {
  return (process.env.ARCA_MODE ?? 'mock') === 'ws' ? new ArcaConstatacionWs() : new ArcaConstatacionMock();
}
