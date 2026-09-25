import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { rolAlcanza } from '@/lib/roles';
import { buildWhereComprobantes, type FiltrosComprobantes } from '@/lib/comprobantes/query';
import { generarXlsx, type CeldaXlsx } from '@/lib/movimientos/xlsx';

// "IVA compras": una fila por comprobante de lo filtrado, con el desglose
// fiscal tal como vino (moneda original, positivos) y el total pesificado
// firmado (la nota de crédito resta). Pensado para pasarle al contador.
export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireEmpresa(params.empresaSlug, 'CARGADOR');
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const sp = req.nextUrl.searchParams;
  const filtros: FiltrosComprobantes = Object.fromEntries(
    ['q', 'desde', 'hasta', 'estado', 'contraparteId', 'categoriaId', 'canal', 'moneda', 'problema'].map((k) => [k, sp.get(k) ?? undefined]),
  );
  const filas = await ctx.db.movimiento.findMany({
    where: buildWhereComprobantes(filtros, { esValidador: rolAlcanza(ctx.rol, 'VALIDADOR'), usuarioId: ctx.usuario.id }),
    include: { contraparte: true, categoria: true },
    orderBy: [{ fechaDevengamiento: 'asc' }, { createdAt: 'asc' }],
  });
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const encabezados = [
    'fecha_emision', 'tipo_comprobante', 'punto_venta', 'numero', 'cuit_proveedor', 'proveedor', 'categoria', 'estado',
    'moneda', 'tipo_cambio', 'neto_gravado', 'iva_105', 'iva_21', 'iva_27', 'percepciones_iva', 'percepciones_iibb',
    'otros_tributos', 'no_gravado_exento', 'total', 'total_ars_firmado', 'cae', 'arca', 'vencimiento_pago', 'canal', 'archivo',
  ];
  const datos: CeldaXlsx[][] = filas.map((m) => {
    const tc = m.moneda === 'ARS' ? 1 : num(m.tipoCambio);
    const signo = m.tipoComprobante?.startsWith('NOTA_CREDITO') ? -1 : 1;
    const razon = m.contraparte?.razonSocial ?? (m.extraccionRaw as { razonSocialEmisor?: string } | null)?.razonSocialEmisor ?? null;
    return [
      m.fechaDevengamiento?.toISOString().slice(0, 10) ?? null, m.tipoComprobante, m.puntoVenta, m.numero,
      m.contraparte?.cuit ?? m.cuitEmisor, razon, m.categoria?.nombre ?? null, m.estado,
      m.moneda, num(m.tipoCambio), num(m.netoGravado), num(m.iva105), num(m.iva21), num(m.iva27), num(m.percepcionesIva),
      num(m.percepcionesIibb), num(m.otrosTributos), num(m.noGravadoExento), num(m.total),
      m.total != null && tc ? Math.round(signo * Number(m.total) * tc * 100) / 100 : null,
      m.cae, m.arcaEstado, m.fechaVencimientoPago?.toISOString().slice(0, 10) ?? null, m.canalIngreso, m.archivoNombre,
    ];
  });
  const buffer = await generarXlsx('IVA compras', encabezados, datos);
  const nombre = `iva-compras-${params.empresaSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
}
