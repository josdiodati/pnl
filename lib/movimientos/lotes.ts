// Resumen de un lote de ingesta para /carga: cuántos comprobantes siguen en
// proceso y cómo terminaron los demás. Puro: recibe los movimientos del lote
// y devuelve los buckets en orden estable de render.

export type MovimientoDeLote = {
  estado: string;
  flags: unknown;
  /** Acción automática que registró el pipeline (AuditLog AUTO_VALIDAR /
   *  AUTO_ASIGNAR). null = no hubo: lo validó/asignó una persona. Sin el campo
   *  (undefined) se asume automático, como antes de distinguirlo. */
  auto?: 'AUTO_VALIDAR' | 'AUTO_ASIGNAR' | null;
};

export type ResumenLote = {
  total: number;
  enProceso: number; // INGRESADO | PROCESANDO
  resultados: { clave: ClaveResultado; cantidad: number }[];
};

export type ClaveResultado =
  | 'pendientes'
  | 'auto-validados'
  | 'auto-asignados'
  | 'validados'
  | 'asignados'
  | 'observados'
  | 'retenidos'
  | 'archivo-duplicado'
  | 'duplicados'
  | 'errores'
  | 'no-comprobantes'
  | 'anulados';

export const RESULTADO_LABEL: Record<ClaveResultado, string> = {
  pendientes: 'pendientes de validación',
  'auto-validados': 'auto-validados',
  'auto-asignados': 'auto-asignados',
  validados: 'validados a mano',
  asignados: 'asignados a mano',
  observados: 'observados',
  retenidos: 'retenidos',
  'archivo-duplicado': 'archivo duplicado',
  duplicados: 'duplicados',
  errores: 'errores',
  'no-comprobantes': 'no eran comprobantes (se borran a los 7 días)',
  anulados: 'anulados',
};

const ORDEN: ClaveResultado[] = [
  'pendientes',
  'auto-validados',
  'auto-asignados',
  'validados',
  'asignados',
  'observados',
  'retenidos',
  'archivo-duplicado',
  'duplicados',
  'errores',
  'no-comprobantes',
  'anulados',
];

function claveDe(mov: MovimientoDeLote): ClaveResultado | null {
  switch (mov.estado) {
    case 'PENDIENTE_VALIDACION':
      return 'pendientes';
    case 'VALIDADO':
      return mov.auto === null ? 'validados' : 'auto-validados';
    case 'ASIGNADO':
      // Auto-validado por el pipeline pero imputado después por una persona:
      // la asignación fue manual.
      return mov.auto === undefined || mov.auto === 'AUTO_ASIGNAR' ? 'auto-asignados' : 'asignados';
    case 'OBSERVADO':
      return 'observados';
    case 'RETENIDO':
      return 'retenidos';
    case 'DUPLICADO':
      // El duplicado por ARCHIVO (hash) se apartó en la ingesta sin extraer;
      // el resto son duplicados por valores confirmados por QR/ARCA.
      return (mov.flags as { duplicadoArchivo?: string } | null)?.duplicadoArchivo
        ? 'archivo-duplicado'
        : 'duplicados';
    case 'ERROR_PROCESAMIENTO':
      return 'errores';
    case 'NO_COMPROBANTE':
      return 'no-comprobantes';
    case 'ANULADO':
      return 'anulados';
    default:
      return null; // INGRESADO | PROCESANDO: todavía en curso
  }
}

export function resumirLote(movs: MovimientoDeLote[]): ResumenLote {
  const cantidades = new Map<ClaveResultado, number>();
  let enProceso = 0;
  for (const mov of movs) {
    const clave = claveDe(mov);
    if (clave == null) enProceso++;
    else cantidades.set(clave, (cantidades.get(clave) ?? 0) + 1);
  }
  return {
    total: movs.length,
    enProceso,
    resultados: ORDEN.filter((c) => cantidades.has(c)).map((c) => ({ clave: c, cantidad: cantidades.get(c)! })),
  };
}

/** Comprobantes del lote con su resultado, en el orden de los chips; lo que
 *  sigue en proceso (clave null) va al final. Orden estable dentro de cada grupo. */
export function detalleLote<M extends MovimientoDeLote>(movs: M[]): { mov: M; clave: ClaveResultado | null }[] {
  const pos = (c: ClaveResultado | null) => (c == null ? ORDEN.length : ORDEN.indexOf(c));
  return movs
    .map((mov) => ({ mov, clave: claveDe(mov) }))
    .sort((a, b) => pos(a.clave) - pos(b.clave));
}

// Estado de la tarjeta del lote en /carga. Un drop crea el lote con la primera
// tanda y declara cuántos archivos vienen; las demás tandas llegan en segundos.
// Durante esa ventana faltar comprobantes es normal ("en curso"). Después, lo
// que falta no va a aparecer (una tanda que no llegó, o duplicados borrados) y
// se informa como "sin ingresar" en vez de dejar la barra procesando.

export const VENTANA_SUBIDA_MS = 3 * 60 * 1000;

export function estadoLote(
  lote: { archivos: number; createdAt: Date },
  resumen: { total: number; enProceso: number },
  ahora: number = Date.now(),
): { enCurso: boolean; sinIngresar: number } {
  const faltan = Math.max(0, lote.archivos - resumen.total);
  const subiendo = faltan > 0 && ahora - lote.createdAt.getTime() < VENTANA_SUBIDA_MS;
  return {
    enCurso: resumen.enProceso > 0 || subiendo,
    sinIngresar: subiendo ? 0 : faltan,
  };
}
