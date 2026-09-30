import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { formatMoney, formatFecha } from '@/lib/format';
import { MES_LABEL } from '@/lib/periodos';
import { buildWhereComprobanteVinculable, montoVinculableDe } from '@/lib/empleados/vinculos';
import { netoDe } from '@/lib/movimientos/neto';

// Autocompletado del buscador de comprobantes de la ficha del empleado: texto
// libre sobre los comprobantes asignados, los 20 más recientes. Devuelve el
// neto (monto por defecto del vínculo) y el período del comprobante,
// que es el período en el que computa el vínculo.
export async function GET(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  let ctx;
  try {
    ctx = await requireEmpresa(params.empresaSlug, 'ADMINISTRADOR');
  } catch (err) {
    if (isForbidden(err)) return new NextResponse('403 Forbidden', { status: 403 });
    throw err;
  }
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const movimientos = await ctx.db.movimiento.findMany({
    where: buildWhereComprobanteVinculable(q),
    include: { contraparte: true, categoria: true, periodo: true },
    orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });
  return NextResponse.json(
    movimientos.map((m) => {
      const neto = montoVinculableDe(m);
      return {
        id: m.id,
        nombre: nombreContraparte(m as never).nombre ?? 'Sin identificar',
        descripcion: [m.categoria?.nombre, m.descripcion].filter(Boolean).join(' · '),
        fecha: formatFecha(m.fechaDevengamiento ?? m.createdAt),
        monto: formatMoney(m.total != null ? Number(m.total) : null),
        neto,
        netoTexto: m.total != null ? formatMoney(netoDe(m)) : null,
        periodo: m.periodo ? `${MES_LABEL[m.periodo.mes]} ${m.periodo.anio}` : null,
      };
    }),
  );
}
