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
};

const COMPONENTES = [
  'netoGravado', 'iva21', 'iva105', 'iva27',
  'percepcionesIva', 'percepcionesIibb', 'otrosTributos', 'noGravadoExento',
];

export function evaluarAutovalidacion(e: EntradaAutoval): { apto: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (e.qrEstado !== 'OK') motivos.push('QR no legible');
  if (!e.esComprobanteFiscalArg) motivos.push('no es comprobante fiscal argentino');
  if (!e.cae) motivos.push('sin CAE');
  if (!e.qrAporto) motivos.push('el QR no aportó el encabezado');
  if (e.hayDuplicados) motivos.push('posible duplicado');
  if (e.moneda && e.moneda !== 'ARS' && !(e.tipoCambio && e.tipoCambio > 0)) {
    motivos.push('moneda extranjera sin tipo de cambio');
  }
  if (e.total == null) {
    motivos.push('sin total');
  } else {
    const suma = COMPONENTES.reduce((acc, k) => acc + (e.importes[k] ?? 0), 0);
    const tolerancia = Math.max(1, Math.abs(e.total) * 0.001);
    if (Math.abs(suma - e.total) > tolerancia) motivos.push('la aritmética no cuadra');
  }
  return { apto: motivos.length === 0, motivos };
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
