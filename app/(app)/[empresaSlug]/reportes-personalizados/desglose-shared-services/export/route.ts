import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { isForbidden } from '@/lib/errors';
import { requireReporte } from '@/lib/reportes-personalizados/acceso';
import { reporteDelCatalogo } from '@/lib/reportes-personalizados/catalogo';
import { cargarDetalleCc } from '@/lib/reportes-personalizados/detalle-cc-datos';
import { filasExportDetalle } from '@/lib/reportes-personalizados/detalle-cc';
import { slugify } from '@/lib/format';

// XLSX de "Detalle CC": lo mismo que la pantalla (mismos filtros), con las
// secciones, subtotales y resultados en negrita. Importes como números.

const ID = 'desglose-shared-services';

export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireReporte(params.empresaSlug, ID);
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const sp = req.nextUrl.searchParams;
  const r = await cargarDetalleCc(ctx, {
    centro: sp.get('centro') ?? undefined,
    desde: sp.get('desde') ?? undefined,
    hasta: sp.get('hasta') ?? undefined,
  });
  if (!r.centro) return new NextResponse('La empresa no tiene centros de costo.', { status: 404 });

  const titulo = reporteDelCatalogo(ID)!.titulo;
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet(titulo);
  hoja.addRow([`${titulo} — ${r.centro.nombre}`]).font = { bold: true, size: 13 };
  hoja.addRow([`${ctx.empresa.razonSocial} · ${r.rango.desde} a ${r.rango.hasta} · montos netos en $`]);
  hoja.addRow([]);
  hoja.addRow(['Mes', 'Documento', 'Concepto', 'Detalle', 'Neto documento', '% aplicado', 'Importe al centro']).font = { bold: true };
  for (const f of filasExportDetalle(r.desglose, r.secciones, r.textos)) {
    const fila = hoja.addRow([
      f.mes,
      f.nivel === 'categoria' ? `  ${f.documento}` : f.documento,
      f.concepto,
      f.detalle,
      f.neto,
      f.porcentaje != null ? f.porcentaje / 100 : null,
      f.importe,
    ]);
    if (f.nivel !== 'item' && f.nivel !== 'prorrateo') fila.font = { bold: true };
  }
  hoja.getColumn(5).numFmt = '#,##0.00';
  hoja.getColumn(6).numFmt = '0.00##%';
  hoja.getColumn(7).numFmt = '#,##0.00';
  [8, 26, 34, 30, 16, 11, 16].forEach((w, i) => (hoja.getColumn(i + 1).width = w));

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const nombre = `detalle-cc-${slugify(r.centro.nombre)}-${r.rango.desde}-a-${r.rango.hasta}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
}
