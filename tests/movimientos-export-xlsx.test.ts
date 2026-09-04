import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { generarXlsx } from '@/lib/movimientos/xlsx';

// El export de Movimientos existe para sumarse en Excel: los importes tienen
// que llegar como números reales (no texto con coma), y los textos intactos.
describe('generarXlsx', () => {
  async function leer(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return wb.worksheets[0];
  }

  it('genera un libro con encabezados en la primera fila y una hoja con el nombre dado', async () => {
    const buffer = await generarXlsx('Movimientos', ['fecha', 'importe'], []);
    const hoja = await leer(buffer);
    expect(hoja.name).toBe('Movimientos');
    expect(hoja.getRow(1).getCell(1).value).toBe('fecha');
    expect(hoja.getRow(1).getCell(2).value).toBe('importe');
  });

  it('los números llegan como números y los textos como texto', async () => {
    const buffer = await generarXlsx('Movimientos', ['contraparte', 'importe'], [
      ['ACME S.A.', -1234.56],
    ]);
    const hoja = await leer(buffer);
    expect(hoja.getRow(2).getCell(1).value).toBe('ACME S.A.');
    expect(hoja.getRow(2).getCell(2).value).toBe(-1234.56);
  });

  it('null queda como celda vacía', async () => {
    const buffer = await generarXlsx('Movimientos', ['a', 'b'], [[null, 'x']]);
    const hoja = await leer(buffer);
    expect(hoja.getRow(2).getCell(1).value).toBeNull();
    expect(hoja.getRow(2).getCell(2).value).toBe('x');
  });
});
