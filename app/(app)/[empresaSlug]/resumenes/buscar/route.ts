import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { buildWhereMovimientoConciliable } from '@/lib/resumenes/busqueda';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { formatMoney, formatFecha } from '@/lib/format';

// Autocompletado del buscador manual del panel de conciliación: texto libre
// sobre los movimientos todavía conciliables, los 20 más recientes.
export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireEmpresa(params.empresaSlug, 'VALIDADOR');
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const movimientos = await ctx.db.movimiento.findMany({
    where: buildWhereMovimientoConciliable(q),
    include: { contraparte: true },
    orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });
  return NextResponse.json(
    movimientos.map((m) => ({
      id: m.id,
      nombre: nombreContraparte(m as never).nombre ?? 'Sin identificar',
      descripcion: m.descripcion ?? '',
      fecha: formatFecha(m.fechaDevengamiento ?? m.createdAt),
      monto: formatMoney(m.total != null ? Number(m.total) : null),
    })),
  );
}
