import ExcelJS from 'exceljs';

export type CeldaXlsx = string | number | null;

// Los importes van como números (no texto con coma) para que Excel los sume
// sin conversión manual.
export async function generarXlsx(
  nombreHoja: string,
  encabezados: string[],
  filas: CeldaXlsx[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet(nombreHoja);
  hoja.addRow(encabezados).font = { bold: true };
  for (const fila of filas) hoja.addRow(fila);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
