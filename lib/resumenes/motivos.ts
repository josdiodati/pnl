// Motivos rápidos para ignorar una línea de resumen (chips del panel de
// conciliación). Los de MOTIVOS_IGNORO_PNL además computan en el Reporte P&L
// como sección "Cargos de resúmenes" (fila por motivo) — se matchea por el
// texto exacto guardado en motivoIgnorada, así que no renombrar a la ligera.
export const MOTIVOS_IGNORO_PNL = ['Consumo sin comprobante', 'Seguros', 'Comisiones'] as const;

export const MOTIVOS_IGNORO_RAPIDO = [
  'Pago del resumen',
  'Saldo/subtotal',
  'Ya cargado a mano',
  'Movimiento sin consumo',
  ...MOTIVOS_IGNORO_PNL,
] as const;
