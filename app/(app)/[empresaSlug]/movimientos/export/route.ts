import { NextRequest, NextResponse } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isForbidden } from '@/lib/errors';
import { rolAlcanza } from '@/lib/roles';
import { buildWhereMovimientos, totalFirmadoDe, montoVinculadoCentavos, type FiltrosMovimientos } from '@/lib/movimientos/query';
import { importesPorLinea } from '@/lib/movimientos/distribucion';
import { resumirCostosPersonal } from '@/lib/empleados/costos';
import { generarXlsx, type CeldaXlsx } from '@/lib/movimientos/xlsx';

// XLSX export of the filtered selection: one row per assignment line, so the
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
    ['desde', 'hasta', 'categoriaId', 'centroCostoId', 'clienteId', 'proyectoId', 'contraparteId', 'origen', 'estado', 'canal', 'q']
      .map((k) => [k, sp.get(k) ?? undefined]),
  );

  const movimientos = await ctx.db.movimiento.findMany({
    where: buildWhereMovimientos(filtros, { esValidador, usuarioId: ctx.usuario.id }),
    include: {
      categoria: true,
      contraparte: true,
      lineas: { include: { centroCosto: true, cliente: true, proyecto: true } },
      vinculosEmpleados: { select: { monto: true } },
    },
    orderBy: [{ fechaDevengamiento: 'asc' }, { createdAt: 'asc' }],
  });

  // Costos de personal del rango filtrado: recibos CONFIRMADOS cuyos períodos
  // caen en [desde, hasta] (por mes) + porciones vinculadas de los movimientos
  // exportados (mismo cálculo que en la página de Movimientos).
  const dentroDelRango = (anio: number, mes: number) => {
    const clave = anio * 100 + mes;
    const desde = filtros.desde ? Number(filtros.desde.slice(0, 7).replace('-', '')) : null;
    const hasta = filtros.hasta ? Number(filtros.hasta.slice(0, 7).replace('-', '')) : null;
    return (desde == null || clave >= desde) && (hasta == null || clave <= hasta);
  };
  const [recibosConfirmados, vinculosDeSeleccion] = await Promise.all([
    ctx.db.reciboSueldo.findMany({
      where: { estado: 'CONFIRMADO' },
      include: { periodo: true, lineas: true },
    }),
    ctx.db.movimientoEmpleado.findMany({
      where: { movimientoId: { in: movimientos.map((m) => m.id) } },
      include: { empleado: { include: { distribucion: true } } },
    }),
  ]);
  const resumenPersonal = resumirCostosPersonal(
    recibosConfirmados
      .filter((r) => dentroDelRango(r.periodo.anio, r.periodo.mes))
      .map((r) => ({ costoTotalEmpleador: r.costoTotalEmpleador, lineas: r.lineas })),
    vinculosDeSeleccion.map((v) => ({ monto: v.monto, lineasEmpleado: v.empleado.distribucion })),
  );
  // Si se filtra por centro de costo o cliente, la línea agregada respeta esa
  // porción, igual que las filas de datos (que ya vienen filtradas por where).
  const personalMostrado = filtros.centroCostoId
    ? resumenPersonal.porCentroCosto.get(filtros.centroCostoId) ?? 0
    : filtros.clienteId
      ? resumenPersonal.porCliente.get(filtros.clienteId) ?? 0
      : resumenPersonal.total;

  // El desglose impositivo va tal como vino del comprobante: valores positivos
  // en su moneda original (el signo y la pesificación quedan en las columnas
  // firmadas del final).
  const encabezados = [
    'fecha', 'origen', 'estado', 'canal', 'contraparte', 'cuit', 'categoria', 'tipo_categoria',
    'tipo_comprobante', 'punto_venta', 'numero', 'descripcion', 'moneda', 'tipo_cambio',
    'neto_gravado', 'iva_105', 'iva_21', 'iva_27', 'percepciones_iva', 'percepciones_iibb',
    'otros_tributos', 'no_gravado_exento', 'total_comprobante',
    'centro_costo', 'cliente', 'proyecto', 'porcentaje', 'importe_linea', 'total_movimiento_firmado',
  ];
  const filas: CeldaXlsx[][] = [];

  for (const m of movimientos) {
    // A diferencia de la pantalla (que muestra el movimiento entero, con el
    // badge "· vinculado a empleados"), el export existe para sumarse en Excel:
    // cada línea descuenta la porción vinculada a empleados (mismo ajuste que
    // resumirMovimientos) para que sumar todas las filas + la línea agregada
    // de "Costos de personal" dé el resultado correcto, sin doble conteo.
    const firmadoBruto = totalFirmadoDe(m as never);
    const vinculado = montoVinculadoCentavos(m as never);
    const firmado = firmadoBruto == null
      ? null
      : firmadoBruto < 0
        ? Math.min(firmadoBruto + vinculado, 0)
        : Math.max(firmadoBruto - vinculado, 0);
    const base: CeldaXlsx[] = [
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
      m.tipoCambio != null ? Number(m.tipoCambio) : null,
      m.netoGravado != null ? Number(m.netoGravado) : null,
      m.iva105 != null ? Number(m.iva105) : null,
      m.iva21 != null ? Number(m.iva21) : null,
      m.iva27 != null ? Number(m.iva27) : null,
      m.percepcionesIva != null ? Number(m.percepcionesIva) : null,
      m.percepcionesIibb != null ? Number(m.percepcionesIibb) : null,
      m.otrosTributos != null ? Number(m.otrosTributos) : null,
      m.noGravadoExento != null ? Number(m.noGravadoExento) : null,
      m.total != null ? Number(m.total) : null,
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
        filas.push([
          ...base,
          l.centroCosto.nombre,
          l.cliente?.nombre ?? '',
          l.proyecto?.nombre ?? '',
          Number(l.porcentaje),
          importes ? importes[i] / 100 : null,
          firmado / 100,
        ]);
      });
    } else {
      filas.push([...base, '', '', '', null, null, firmado != null ? firmado / 100 : null]);
    }
  }

  // Línea agregada de costos de personal: un único total, sin detalle por
  // empleado (las columnas no aplicables quedan vacías).
  filas.push([
    '', '', '', '', '', '', '', '', '', '', '',
    'Costos de personal (recibos + vinculados)',
    '', null, null, null, null, null, null, null, null, null, null,
    '', '', '', null,
    null,
    personalMostrado / 100,
  ]);

  const buffer = await generarXlsx('Movimientos', encabezados, filas);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="movimientos-${params.empresaSlug}.xlsx"`,
    },
  });
}
