// Costo real de la prepaga por empleado (vista de gestión, NO contable — el
// libro sigue mostrando las facturas agregadas):
//
//   neto = costo del plan − FSR% × (aportes + contribuciones de obra social)
//
// A la prepaga sólo le llega ~85% de lo derivado (el Fondo Solidario de
// Redistribución retiene el resto); el % es editable por registro. Si el neto
// da negativo, en las vistas de empleados/proyectos computa 0.

export type DatosPrepaga = {
  costoPlan: number;
  aportes: number;
  contribuciones: number;
  fsrPct: number; // % que efectivamente llega a la prepaga (default 85)
};

/** Neto real en centavos (puede ser negativo: los aportes superan el plan). */
export function netoPrepaga(p: DatosPrepaga): number {
  const plan = Math.round(p.costoPlan * 100);
  const derivado = Math.round((p.aportes + p.contribuciones) * (p.fsrPct / 100) * 100);
  return plan - derivado;
}

/** Lo que computa en reportes: nunca negativo. */
export function netoComputable(p: DatosPrepaga): number {
  return Math.max(0, netoPrepaga(p));
}

export type ConceptoRecibo = { concepto: string; unidad?: string | null; importe: number; naturaleza: string };

/**
 * Precarga de aportes/contribuciones de obra social desde los conceptos del
 * recibo del período: el aporte del empleado es la RETENCION "Obra Social" y
 * la patronal es la CONTRIBUCION "… Obra Social".
 */
export function aportesObraSocialDeConceptos(conceptos: ConceptoRecibo[] | null | undefined): {
  aportes: number;
  contribuciones: number;
} {
  let aportes = 0;
  let contribuciones = 0;
  for (const c of conceptos ?? []) {
    if (!/obra\s*social/i.test(c.concepto)) continue;
    if (c.naturaleza === 'RETENCION') aportes += c.importe;
    else if (c.naturaleza === 'CONTRIBUCION_EMPLEADOR') contribuciones += c.importe;
  }
  return { aportes, contribuciones };
}
