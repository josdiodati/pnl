// Lo que leyó el OCR de un comprobante, preparado para elegir la palabra clave
// de una regla: el texto contra el que matchea `reglaMatchea` (razón social de
// la contraparte + descripción) y los campos crudos de la extracción.

export type OcrParaRegla = {
  textoMatching: string;
  campos: { label: string; valor: string }[];
};

const LABELS: Record<string, string> = {
  razonSocialEmisor: 'Razón social emisor',
  razonSocialReceptor: 'Razón social receptor',
  concepto: 'Concepto',
  observaciones: 'Observaciones',
  tipoComprobante: 'Tipo',
  puntoVenta: 'Punto de venta',
  numero: 'Número',
  fechaEmision: 'Fecha de emisión',
  cuitEmisor: 'CUIT emisor',
  cuitReceptor: 'CUIT receptor',
  total: 'Total',
  moneda: 'Moneda',
  cae: 'CAE',
};
// Los campos de texto largos van primero: son los útiles para una palabra clave.
const ORDEN_PRIMERO = ['concepto', 'observaciones', 'razonSocialEmisor', 'razonSocialReceptor'];

export function ocrParaRegla(input: {
  extraccionRaw: unknown;
  descripcion: string | null;
  razonSocialContraparte: string | null;
}): OcrParaRegla {
  const raw = input.extraccionRaw && typeof input.extraccionRaw === 'object' ? (input.extraccionRaw as Record<string, unknown>) : {};
  const entradas = Object.entries(raw).filter(([, v]) => v != null && typeof v !== 'object' && typeof v !== 'boolean');
  entradas.sort(([a], [b]) => {
    const ia = ORDEN_PRIMERO.indexOf(a);
    const ib = ORDEN_PRIMERO.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const campos = entradas
    .map(([k, v]) => ({ label: LABELS[k] ?? k, valor: String(v).trim() }))
    .filter((c) => c.valor);
  const textoMatching = `${input.razonSocialContraparte ?? ''} ${input.descripcion ?? ''}`.replace(/\s+/g, ' ').trim();
  return { textoMatching, campos };
}
