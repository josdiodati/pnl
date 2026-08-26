import { importesPorLinea, type LineaDistribucion } from '@/lib/movimientos/distribucion';

// Consolidación query-time del bloque "Costos de personal" del proto-P&L:
// recibos CONFIRMADOS (por sus líneas copiadas) + porciones vinculadas de
// comprobantes ASIGNADOS (por la distribución de la ficha del empleado).
// Todo en centavos NEGATIVOS: el costo de personal es un egreso.

export type LineaResumen = { centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: unknown };
export type ReciboParaResumen = { costoTotalEmpleador: unknown; lineas: LineaResumen[] };
export type VinculoParaResumen = { monto: unknown; lineasEmpleado: LineaResumen[] };
/** Movimiento ASIGNADO de una categoría marcada "es costo de personal" (ej. Prepagas). */
export type MovimientoPersonalParaResumen = { firmadoCentavos: number; lineas: LineaResumen[] };

export type ResumenPersonal = {
  total: number;
  porCentroCosto: Map<string, number>;
  porCliente: Map<string, number>;
};

function acumular(resumen: ResumenPersonal, firmado: number, lineas: LineaResumen[]): void {
  resumen.total += firmado;
  if (!lineas.length) return;
  const parsed: LineaDistribucion[] = lineas.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId,
    proyectoId: l.proyectoId,
    porcentaje: Number(l.porcentaje),
  }));
  try {
    const importes = importesPorLinea(firmado, parsed);
    parsed.forEach((l, i) => {
      resumen.porCentroCosto.set(l.centroCostoId, (resumen.porCentroCosto.get(l.centroCostoId) ?? 0) + importes[i]);
      if (l.clienteId) resumen.porCliente.set(l.clienteId, (resumen.porCliente.get(l.clienteId) ?? 0) + importes[i]);
    });
  } catch {
    // líneas inconsistentes: el total ya se sumó, se omite el desglose
  }
}

export function resumirCostosPersonal(
  recibos: ReciboParaResumen[],
  vinculos: VinculoParaResumen[],
  movimientosPersonal: MovimientoPersonalParaResumen[] = [],
): ResumenPersonal {
  const resumen: ResumenPersonal = { total: 0, porCentroCosto: new Map(), porCliente: new Map() };
  for (const r of recibos) {
    if (r.costoTotalEmpleador == null) continue;
    acumular(resumen, -Math.round(Number(r.costoTotalEmpleador) * 100), r.lineas);
  }
  for (const v of vinculos) {
    if (v.monto == null) continue;
    acumular(resumen, -Math.round(Number(v.monto) * 100), v.lineasEmpleado);
  }
  for (const m of movimientosPersonal) {
    acumular(resumen, m.firmadoCentavos, m.lineas);
  }
  return resumen;
}
