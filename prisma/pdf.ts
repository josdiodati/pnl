// Minimal one-page PDF generator (valid, uncompressed, Helvetica) used by the
// seed to create sample invoices. The text layer includes a `PNL-MOCK:{json}`
// marker that the mock extractor reads as if it were perfect OCR, so the demo
// pipeline produces meaningful, deterministic data without any credentials.

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makeInvoicePdf(lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 11 Tf',
    '50 790 Td',
    '14 TL',
    ...lines.map((l) => `(${escapePdfText(l)}) Tj T*`),
    'ET',
  ].join('\n');

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Invoice-looking PDF whose mock-OCR marker carries the given extraction. */
export function makeFacturaPdf(datos: {
  razonSocialEmisor: string;
  cuitEmisor: string;
  tipoComprobante: string;
  puntoVenta: string;
  numero: string;
  fechaEmision: string;
  netoGravado: number;
  iva21: number;
  total: number;
  cae: string;
  vencimientoCae: string;
}): Buffer {
  // Flat JSON only (no nested objects): the mock extractor's marker regex is lazy.
  const marker = JSON.stringify({
    tipoComprobante: datos.tipoComprobante,
    puntoVenta: datos.puntoVenta,
    numero: datos.numero,
    fechaEmision: datos.fechaEmision,
    cuitEmisor: datos.cuitEmisor,
    razonSocialEmisor: datos.razonSocialEmisor,
    netoGravado: datos.netoGravado,
    iva21: datos.iva21,
    iva105: null,
    iva27: null,
    percepcionesIva: null,
    percepcionesIibb: null,
    otrosTributos: null,
    noGravadoExento: null,
    total: datos.total,
    moneda: 'ARS',
    cae: datos.cae,
    vencimientoCae: datos.vencimientoCae,
    observaciones: 'Leido del marcador PNL-MOCK del PDF de ejemplo',
  });
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  return makeInvoicePdf([
    datos.razonSocialEmisor,
    `CUIT: ${datos.cuitEmisor}`,
    '',
    `${datos.tipoComprobante.replace(/_/g, ' ')}  ${datos.puntoVenta}-${datos.numero}`,
    `Fecha de emision: ${datos.fechaEmision}`,
    '',
    `Neto gravado:        $ ${fmt(datos.netoGravado)}`,
    `IVA 21%:             $ ${fmt(datos.iva21)}`,
    `TOTAL:               $ ${fmt(datos.total)}`,
    '',
    `CAE: ${datos.cae}    Vto. CAE: ${datos.vencimientoCae}`,
    '',
    'Documento de ejemplo generado por el seed de P&L Manager.',
    `PNL-MOCK:${marker}`,
  ]);
}
