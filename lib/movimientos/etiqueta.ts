// Etiqueta de una línea del libro para elegirla en un selector (asiento
// relacionado, etc.): fecha · contraparte · tipo y número · total. Pura.

const ORIGEN_LABEL: Record<string, string> = {
  ASIENTO_MANUAL: 'Asiento manual',
  VENTA_MANUAL: 'Venta manual',
  RESUMEN: 'Resumen',
};

export function etiquetaComprobante(e: {
  fecha: string;
  contraparte: string | null;
  tipo: string | null;
  puntoVenta: string | null;
  numero: string | null;
  total: string;
  origen?: string | null;
}): string {
  const numero = [e.puntoVenta, e.numero].filter(Boolean).join('-');
  const tipo = [e.tipo?.replace(/_/g, ' '), numero].filter(Boolean).join(' ') || (e.origen ? ORIGEN_LABEL[e.origen] : '') || '';
  return [e.fecha, e.contraparte ?? 'Sin contraparte', tipo, e.total].filter(Boolean).join(' · ');
}
