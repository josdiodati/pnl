import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { rolAlcanza } from '@/lib/roles';
import { buildWhereMovimientos, totalFirmadoDe, type FiltrosMovimientos } from '@/lib/movimientos/query';
import { importesPorLinea } from '@/lib/movimientos/distribucion';

// CSV export of the filtered selection: one row per assignment line, so the
// double dimension (cost center + client/project) lands directly in Excel.
export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireEmpresa(params.empresaSlug, 'CARGADOR');
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');
  const sp = req.nextUrl.searchParams;
  const filtros: FiltrosMovimientos = Object.fromEntries(
    ['desde', 'hasta', 'categoriaId', 'centroCostoId', 'clienteId', 'contraparteId', 'origen', 'estado', 'canal']
      .map((k) => [k, sp.get(k) ?? undefined]),
  );

  const movimientos = await ctx.db.movimiento.findMany({
    where: buildWhereMovimientos(filtros, { esValidador, usuarioId: ctx.usuario.id }),
    include: {
      categoria: true,
      contraparte: true,
      lineas: { include: { centroCosto: true, cliente: true, proyecto: true } },
    },
    orderBy: [{ fechaDevengamiento: 'asc' }, { createdAt: 'asc' }],
  });

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas: string[] = [
    [
      'fecha', 'origen', 'estado', 'canal', 'contraparte', 'cuit', 'categoria', 'tipo_categoria',
      'tipo_comprobante', 'punto_venta', 'numero', 'descripcion', 'moneda',
      'centro_costo', 'cliente', 'proyecto', 'porcentaje', 'importe_linea', 'total_movimiento_firmado',
    ].join(';'),
  ];

  for (const m of movimientos) {
    const firmado = totalFirmadoDe(m as never);
    const base = [
      m.fechaDevengamiento?.toISOString().slice(0, 10) ?? '',
      m.origen,
      m.estado,
      m.canalIngreso ?? '',
      m.contraparte?.razonSocial ?? '',
      m.contraparte?.cuit ?? m.cuitEmisor ?? '',
      m.categoria?.nombre ?? '',
      m.categoria?.tipo ?? '',
      m.tipoComprobante ?? '',
      m.puntoVenta ?? '',
      m.numero ?? '',
      m.descripcion ?? '',
      m.moneda,
    ];
    if (m.lineas.length && firmado != null) {
      const lineas = m.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId,
        porcentaje: Number(l.porcentaje),
      }));
      let importes: number[] | null = null;
      try {
        importes = importesPorLinea(firmado, lineas);
      } catch {
        importes = null;
      }
      m.lineas.forEach((l, i) => {
        filas.push(
          [
            ...base,
            l.centroCosto.nombre,
            l.cliente?.nombre ?? '',
            l.proyecto?.nombre ?? '',
            String(Number(l.porcentaje)).replace('.', ','),
            importes ? (importes[i] / 100).toFixed(2).replace('.', ',') : '',
            (firmado / 100).toFixed(2).replace('.', ','),
          ].map(esc).join(';'),
        );
      });
    } else {
      filas.push(
        [...base, '', '', '', '', '', firmado != null ? (firmado / 100).toFixed(2).replace('.', ',') : ''].map(esc).join(';'),
      );
    }
  }

  return new NextResponse('﻿' + filas.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="movimientos-${params.empresaSlug}.csv"`,
    },
  });
}
