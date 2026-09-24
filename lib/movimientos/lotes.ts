// Resumen de un lote de ingesta para /carga: cuántos comprobantes siguen en
// proceso y cómo terminaron los demás. Puro: recibe los movimientos del lote
// y devuelve los buckets en orden estable de render.

export type MovimientoDeLote = { estado: string; flags: unknown };

export type ResumenLote = {
  total: number;
  enProceso: number; // INGRESADO | PROCESANDO
  resultados: { clave: ClaveResultado; cantidad: number }[];
};

export type ClaveResultado =
  | 'pendientes'
  | 'auto-validados'
  | 'auto-asignados'
  | 'observados'
  | 'retenidos'
  | 'archivo-duplicado'
  | 'duplicados'
  | 'errores'
  | 'anulados';

export const RESULTADO_LABEL: Record<ClaveResultado, string> = {
  pendientes: 'pendientes de validación',
  'auto-validados': 'auto-validados',
  'auto-asignados': 'auto-asignados',
  observados: 'observados',
  retenidos: 'retenidos',
  'archivo-duplicado': 'archivo duplicado',
  duplicados: 'duplicados',
  errores: 'errores',
  anulados: 'anulados',
};

const ORDEN: ClaveResultado[] = [
  'pendientes',
  'auto-validados',
  'auto-asignados',
  'observados',
  'retenidos',
  'archivo-duplicado',
  'duplicados',
  'errores',
  'anulados',
];

function claveDe(mov: MovimientoDeLote): ClaveResultado | null {
  switch (mov.estado) {
    case 'PENDIENTE_VALIDACION':
      return 'pendientes';
    case 'VALIDADO':
      return 'auto-validados';
    case 'ASIGNADO':
      return 'auto-asignados';
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
