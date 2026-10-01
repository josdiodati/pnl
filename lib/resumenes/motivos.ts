// Motivos rápidos para resolver una línea de resumen sin comprobante (chips
// del panel de conciliación).
//
// Los de MOTIVOS_CARGO son un gasto real: NO ignoran la línea, la imputan —
// crean un movimiento (origen RESUMEN, 100% al centro de costo elegido) con la
// categoría de CATEGORIA_DE_CARGO, así el cargo aparece en Movimientos y
// computa en el P&L por su categoría, como cualquier imputación. Los demás
// ignoran la línea (no son gasto: pagos, saldos, cobros…).
export const CATEGORIA_DE_CARGO = {
  'Consumo sin comprobante': 'Consumos sin comprobante',
  Seguros: 'Seguros',
  Comisiones: 'Gastos Bancarios',
} as const;

export type MotivoCargo = keyof typeof CATEGORIA_DE_CARGO;
export const MOTIVOS_CARGO = Object.keys(CATEGORIA_DE_CARGO) as MotivoCargo[];

export function esMotivoCargo(motivo: string): motivo is MotivoCargo {
  return (MOTIVOS_CARGO as string[]).includes(motivo.trim());
}

export const MOTIVOS_IGNORO_RAPIDO = [
  'Pago del resumen',
  'Saldo/subtotal',
  'Ya cargado a mano',
  'Movimiento sin consumo',
  // Cobro de facturas que no están en el sistema (anteriores a la carga). Los
  // cobros de facturas cargadas se concilian con "Cobro de facturas…".
  'Cobro anterior al sistema',
  'Rendimientos',
  'Pagos ARCA', // impuestos pagados al fisco: no son gasto del P&L (ya computan por sus comprobantes)
] as const;
