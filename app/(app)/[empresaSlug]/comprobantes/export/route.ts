import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { rolAlcanza } from '@/lib/roles';
import { buildWhereComprobantes, ladoDe, type FiltrosComprobantes } from '@/lib/comprobantes/query';
import { mapaCobranza, hoyUtc } from '@/lib/cobranzas/query';
import { hayFiltroCobranza, idsPorFiltroCobranza } from '@/lib/cobranzas/filtros';
import { generarXlsx, type CeldaXlsx } from '@/lib/movimientos/xlsx';

// "IVA compras" / "IVA ventas": una fila por comprobante de lo filtrado, con el desglose
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
    ['lado', 'cobro', 'tramo', 'semana', 'q', 'desde', 'hasta', 'estado', 'contraparteId', 'categoriaId', 'canal', 'moneda', 'problema'].map((k) => [k, sp.get(k) ?? undefined]),
  );
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');
  const filtroCobranza = { cobro: filtros.cobro, tramo: filtros.tramo, semana: filtros.semana };
  const drill = hayFiltroCobranza(filtroCobranza);
  const lado = drill ? 'ventas' : ladoDe(filtros.lado);
  const hoy = hoyUtc();
  const ids = drill && esValidador ? await idsPorFiltroCobranza(await mapaCobranza(ctx.db, hoy), filtroCobranza, hoy) : null;
  const filas = await ctx.db.movimiento.findMany({
    where: buildWhereComprobantes({ ...filtros, lado }, { esValidador, usuarioId: ctx.usuario.id, ids }),
    include: { contraparte: true, categoria: true },
    orderBy: [{ fechaDevengamiento: 'asc' }, { createdAt: 'asc' }],
  });
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const encabezados = [
    'fecha_emision', 'lado', 'tipo_comprobante', 'punto_venta', 'numero', 'cuit_contraparte', 'contraparte', 'categoria', 'estado',
    'moneda', 'tipo_cambio', 'neto_gravado', 'iva_105', 'iva_21', 'iva_27', 'percepciones_iva', 'percepciones_iibb',
    'otros_tributos', 'no_gravado_exento', 'total', 'total_ars_firmado', 'cae', 'arca', 'vencimiento_pago', 'canal', 'archivo',
  ];
  const datos: CeldaXlsx[][] = filas.map((m) => {
    const tc = m.moneda === 'ARS' ? 1 : num(m.tipoCambio);
    const signo = m.tipoComprobante?.startsWith('NOTA_CREDITO') ? -1 : 1;
    const compra = m.origen === 'COMPROBANTE';
    const raw = m.extraccionRaw as { razonSocialEmisor?: string; razonSocialReceptor?: string } | null;
    const razon = m.contraparte?.razonSocial ?? (compra ? raw?.razonSocialEmisor : raw?.razonSocialReceptor) ?? null;
    return [
      m.fechaDevengamiento?.toISOString().slice(0, 10) ?? null, compra ? 'compra' : 'venta', m.tipoComprobante, m.puntoVenta, m.numero,
      m.contraparte?.cuit ?? (compra ? m.cuitEmisor : null), razon, m.categoria?.nombre ?? null, m.estado,
      m.moneda, num(m.tipoCambio), num(m.netoGravado), num(m.iva105), num(m.iva21), num(m.iva27), num(m.percepcionesIva),
      num(m.percepcionesIibb), num(m.otrosTributos), num(m.noGravadoExento), num(m.total),
      m.total != null && tc ? Math.round(signo * Number(m.total) * tc * 100) / 100 : null,
      m.cae, m.arcaEstado, m.fechaVencimientoPago?.toISOString().slice(0, 10) ?? null, m.canalIngreso, m.archivoNombre,
    ];
  });
  const hoja = lado === 'compras' ? 'IVA compras' : lado === 'ventas' ? 'IVA ventas' : 'Comprobantes';
  const buffer = await generarXlsx(hoja, encabezados, datos);
  const nombre = `${hoja.toLowerCase().replace(/ /g, '-')}-${params.empresaSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
}
