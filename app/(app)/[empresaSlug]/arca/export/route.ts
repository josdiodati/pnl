import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { generarXlsx } from '@/lib/movimientos/xlsx';
import { ENCABEZADOS_EXPORT_ARCA, filasExportArca, parsearFiltrosArca, whereArca } from '@/lib/arca/mis-comprobantes/exportar';

// ARCA · Mis Comprobantes a XLSX, con los mismos filtros que la pantalla (sin
// mes: todos). Cada fila de ARCA lleva al lado el comprobante de PNL con el
// que cruzó, o el motivo por el que se ignoró.
export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireEmpresa(params.empresaSlug, 'VALIDADOR');
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const sp = req.nextUrl.searchParams;
  const filtros = parsearFiltrosArca({ mes: sp.get('mes'), origen: sp.get('origen'), estado: sp.get('estado') }, 'todos');
  const comprobantes = await ctx.db.comprobanteArca.findMany({
    where: whereArca(filtros),
    include: {
      ignoradoPor: { select: { nombre: true } },
      movimiento: { include: { contraparte: { select: { cuit: true, razonSocial: true } }, categoria: { select: { nombre: true } } } },
    },
    orderBy: [{ fechaEmision: 'asc' }, { origen: 'asc' }, { puntoVenta: 'asc' }, { numeroDesde: 'asc' }],
  });
  const urlApp = (process.env.APP_URL || 'https://pnl.ledger.ar').replace(/\/$/, '');
  const buffer = await generarXlsx('ARCA', ENCABEZADOS_EXPORT_ARCA, filasExportArca(comprobantes, urlApp, params.empresaSlug));
  const sufijo = [filtros.mes === 'todos' ? null : filtros.mes, filtros.origen?.toLowerCase(), filtros.estado === 'todos' ? null : filtros.estado].filter(Boolean).join('-');
  const nombre = `arca-${params.empresaSlug}${sufijo ? `-${sufijo}` : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
}
