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
