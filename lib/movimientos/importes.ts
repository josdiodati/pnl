// Componentes del importe de un comprobante, en el orden en que se muestran.
// Compartido por el formulario de validación (editable) y el detalle de solo
// lectura, para que las dos vistas no puedan listar campos distintos.

export const IMPORTES: { campo: string; label: string }[] = [
  { campo: 'netoGravado', label: 'Neto gravado' },
  { campo: 'iva21', label: 'IVA 21%' },
  { campo: 'iva105', label: 'IVA 10,5%' },
  { campo: 'iva27', label: 'IVA 27%' },
  { campo: 'percepcionesIva', label: 'Percep. IVA' },
  { campo: 'percepcionesIibb', label: 'Percep. IIBB' },
  { campo: 'otrosTributos', label: 'Otros tributos' },
  { campo: 'noGravadoExento', label: 'No gravado / exento' },
];

/**
 * Desglose del IVA INCLUIDO en el total (comprobantes B / tickets, donde no
 * viene discriminado): neto = total / (1 + alícuota), redondeado al centavo;
 * el IVA es la diferencia exacta, así neto + iva = total siempre cierra.
 */
export function desglosarIvaIncluido(total: number, alicuotaPct: number): { neto: number; iva: number } {
  const totalCent = Math.round(total * 100);
  const netoCent = Math.round(totalCent / (1 + alicuotaPct / 100));
  return { neto: netoCent / 100, iva: (totalCent - netoCent) / 100 };
}
