// Chequeos determinísticos de autovalidación (puros). El ancla de confianza es
// el QR de ARCA/AFIP (autoritativo en el pipeline) + la aritmética del
// comprobante. ARCA real (web service) queda fuera de alcance por ahora.

export type EntradaAutoval = {
  qrEstado: string | null;
  esComprobanteFiscalArg: boolean;
  cae: string | null;
  qrAporto: boolean; // el QR existió y trajo los campos de encabezado
  importes: Record<string, number | null>;
  total: number | null;
  hayDuplicados: boolean;
  /** Moneda del comprobante y TC (pesos por unidad); una moneda extranjera sin TC no es apta. */
  moneda?: string;
  tipoCambio?: number | null;
  /** false = el comprobante quedó sin contraparte vinculada (el alta automática
   *  se abstuvo): no se autovalida, el validador la crea en la cola. */
  tieneContraparte?: boolean;
};

const COMPONENTES = [
  'netoGravado', 'iva21', 'iva105', 'iva27',
  'percepcionesIva', 'percepcionesIibb', 'otrosTributos', 'noGravadoExento',
];

export function evaluarAutovalidacion(e: EntradaAutoval): { apto: boolean; motivos: string[]; aprobados: string[] } {
  const motivos: string[] = [];
  // `aprobados` alimenta el historial: qué chequeos concretos sostienen una
  // autovalidación (o pasaron igual aunque otro haya fallado).
  const aprobados: string[] = [];
  const chequeo = (paso: boolean, aprobado: string, motivo: string) =>
    paso ? aprobados.push(aprobado) : motivos.push(motivo);

  chequeo(e.qrEstado === 'OK', 'QR legible', 'QR no legible');
  chequeo(!!e.esComprobanteFiscalArg, 'comprobante fiscal argentino', 'no es comprobante fiscal argentino');
  chequeo(!!e.cae, 'CAE presente', 'sin CAE');
  chequeo(e.qrAporto, 'encabezado tomado del QR', 'el QR no aportó el encabezado');
  chequeo(!e.hayDuplicados, 'sin duplicados', 'posible duplicado');
  if (e.moneda && e.moneda !== 'ARS') {
    chequeo(Boolean(e.tipoCambio && e.tipoCambio > 0), 'tipo de cambio presente', 'moneda extranjera sin tipo de cambio');
  }
  if (e.tieneContraparte !== undefined) {
    chequeo(e.tieneContraparte, 'contraparte en el maestro', 'sin contraparte en el maestro');
  }
  if (e.total == null) {
    motivos.push('sin total');
  } else {
    const suma = COMPONENTES.reduce((acc, k) => acc + (e.importes[k] ?? 0), 0);
    const tolerancia = Math.max(1, Math.abs(e.total) * 0.001);
    chequeo(Math.abs(suma - e.total) <= tolerancia, 'la aritmética cuadra', 'la aritmética no cuadra');
  }
  return { apto: motivos.length === 0, motivos, aprobados };
}

/** Estado final a partir de la aptitud y si la asignación resuelta es completa.
 *  Período cerrado nunca autovalida. */
export function decidirAutovalidacion(p: {
  apto: boolean;
  completa: boolean;
  estadoBase: 'PENDIENTE_VALIDACION' | 'RETENIDO';
}): 'PENDIENTE_VALIDACION' | 'RETENIDO' | 'VALIDADO' | 'ASIGNADO' {
  if (p.estadoBase === 'RETENIDO') return 'RETENIDO';
  if (!p.apto) return 'PENDIENTE_VALIDACION';
  return p.completa ? 'ASIGNADO' : 'VALIDADO';
}
