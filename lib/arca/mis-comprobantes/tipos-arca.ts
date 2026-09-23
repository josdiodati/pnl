// Códigos de tipo de comprobante de ARCA (los que aparecen en Mis
// Comprobantes) con su nombre corto para la pantalla.
const NOMBRES: Record<number, string> = {
  1: 'Factura A', 2: 'Nota de débito A', 3: 'Nota de crédito A', 4: 'Recibo A',
  6: 'Factura B', 7: 'Nota de débito B', 8: 'Nota de crédito B', 9: 'Recibo B',
  11: 'Factura C', 12: 'Nota de débito C', 13: 'Nota de crédito C', 15: 'Recibo C',
  19: 'Factura E', 20: 'Nota de débito E', 21: 'Nota de crédito E',
  51: 'Factura M', 52: 'Nota de débito M', 53: 'Nota de crédito M',
  81: 'Tique factura A', 82: 'Tique factura B', 83: 'Tique', 111: 'Tique factura C', 118: 'Tique factura M',
  201: 'FCE A', 202: 'ND FCE A', 203: 'NC FCE A', 206: 'FCE B', 207: 'ND FCE B', 208: 'NC FCE B', 211: 'FCE C', 212: 'ND FCE C', 213: 'NC FCE C',
};

export function nombreTipoArca(codigo: number): string {
  return NOMBRES[codigo] ?? `Tipo ${codigo}`;
}

/** Notas de crédito: restan (para mostrar el signo en la pantalla). */
export function esNotaCreditoArca(codigo: number): boolean {
  return [3, 8, 13, 21, 53, 203, 208, 213].includes(codigo);
}

export function numeroComprobanteArca(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;
}

/** Tipo de comprobante de PNL → código de ARCA (para cruzar con Mis Comprobantes). */
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
