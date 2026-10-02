import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { cargarDatosPnl, prorrateosDelPnl } from '@/lib/reportes/datos-pnl';
import { armarPnl } from '@/lib/reportes/pnl';
import type { CriterioProrrateo } from '@/lib/reportes/prorrateo';
import { agruparDesglose, desglosarCentro, type FilaDesglose } from './desglose-centro';
import { rangoDetalle, type TextosDetalle } from './detalle-cc';

// Datos del reporte "Detalle CC" para la página y su exportable: lo mismo en
// los dos, así la planilla es exactamente lo que se ve en pantalla.

const ORIGEN_LABEL: Record<string, string> = {
  ASIENTO_MANUAL: 'Asiento manual',
  VENTA_MANUAL: 'Venta manual',
  RESUMEN: 'Resumen',
};

export type ParamsDetalleCc = { centro?: string; desde?: string; hasta?: string };

export async function cargarDetalleCc(ctx: EmpresaContext, params: ParamsDetalleCc) {
  const rango = rangoDetalle(params, new Date(), ctx.empresa.inicioEjercicioFiscal);
  const [centros, categorias] = await Promise.all([
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
  ]);
  const centro =
    centros.find((c) => c.id === params.centro) ??
    centros.find((c) => c.activo && /shared/i.test(c.nombre)) ??
    centros.find((c) => c.activo) ??
    centros[0];
  if (!centro) return { rango, centros, centro: null } as const;

  const { meses } = rango;
  const datos = await cargarDatosPnl(ctx.db, meses);
  const conProrrateo = await prorrateosDelPnl(ctx.db, meses, centros.map((c) => ({ id: c.id, prorrateo: c.prorrateo })), datos);
  const desglose = desglosarCentro({
    meses,
    centroId: centro.id,
    movimientos: datos.movimientosPnl,
    recibos: datos.recibosPnl,
    prorrateos: conProrrateo?.prorrateos,
    resultadoEmisor: conProrrateo?.resultadoEmisor,
  });
  // Control: el mismo P&L filtrado que muestra el Reporte P&L.
  const pnl = armarPnl({ meses, movimientos: datos.movimientosPnl, recibos: datos.recibosPnl, filtro: { campo: 'centroCostoId', valor: centro.id } });

  // Mismo orden de categorías que el P&L: padres y sus hijas.
  const ordenCategorias = categorias
    .filter((c) => !c.padreId)
    .flatMap((p) => [p.id, ...categorias.filter((h) => h.padreId === p.id).map((h) => h.id)]);
  const secciones = agruparDesglose(desglose.filas, ordenCategorias);

  const nombreCentro = new Map(centros.map((c) => [c.id, c.nombre]));
  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const movPorId = new Map(datos.movimientos.map((m) => [m.id, m]));
  const recPorId = new Map(datos.recibos.map((r) => [r.id, r]));
  const describir = (f: FilaDesglose) => {
    if (f.tipo === 'RECIBO') {
      const r = recPorId.get(f.id)!;
      return {
        documento: r.tipo === 'MENSUAL' ? 'Recibo de sueldo' : `Recibo ${r.tipo.toLowerCase().replace(/_/g, ' ')}`,
        concepto: r.empleado.nombre,
        ruta: `empleados/recibos/${r.id}`,
      };
    }
    const m = movPorId.get(f.id)!;
    const numero = [m.puntoVenta, m.numero].filter(Boolean).join('-');
    return {
      documento: [m.tipoComprobante?.replace(/_/g, ' '), numero].filter(Boolean).join(' ') || ORIGEN_LABEL[m.origen] || 'Movimiento',
      concepto: m.contraparte?.razonSocial ?? m.descripcion ?? '—',
      detalle: m.contraparte && m.descripcion ? m.descripcion : undefined,
      ruta: `validacion/${m.id}`,
    };
  };
  const textos: TextosDetalle = {
    describir,
    nombreCategoria: (id) => nombreCat.get(id) ?? '?',
    nombreCentro: (id) => nombreCentro.get(id) ?? '?',
    criterioDe: (id) => (centros.find((c) => c.id === id)?.prorrateo as CriterioProrrateo | null) ?? null,
    criterioCentro: (centro.prorrateo as CriterioProrrateo | null) ?? null,
  };

  const suma = (v: number[]) => v.reduce((a, x) => a + x, 0);
  return {
    rango,
    centros,
    centro,
    desglose,
    secciones,
    textos,
    describir,
    diferencia: suma(pnl.resultado) - suma(desglose.resultadoAntes),
  } as const;
}
