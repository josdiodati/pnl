// Nombre a mostrar de la contraparte, compartido por las colas de Validación y
// Asignación. Vive acá y no en cada page.tsx porque tenerlo duplicado ya causó
// un defecto: Validación caía al nombre extraído y Asignación no, así que el
// dato desaparecía al pasar de una cola a la otra.
//
// La contraparte es el EMISOR en compras y el RECEPTOR en ventas.

export type MovimientoParaNombre = {
  origen: string;
  contraparte: { razonSocial: string } | null;
  cuitEmisor: string | null;
  extraccionRaw: unknown;
};

export type NombreContraparte = {
  /** null cuando no hay ni maestro ni extracción: la vista muestra "Sin identificar". */
  nombre: string | null;
  /** Tiene identidad (CUIT) pero todavía no está en el maestro. */
  esNueva: boolean;
};

export function esVenta(origen: string): boolean {
  return origen === 'VENTA_COMPROBANTE' || origen === 'VENTA_MANUAL';
}

function limpiar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function nombreContraparte(mov: MovimientoParaNombre): NombreContraparte {
  if (mov.contraparte) return { nombre: mov.contraparte.razonSocial, esNueva: false };

  const extr = mov.extraccionRaw as { razonSocialEmisor?: unknown; razonSocialReceptor?: unknown } | null;
  const extraido = esVenta(mov.origen) ? limpiar(extr?.razonSocialReceptor) : limpiar(extr?.razonSocialEmisor);

  return { nombre: extraido, esNueva: limpiar(mov.cuitEmisor) != null };
}

/** CUIT de la contraparte del movimiento: emisor en compras, receptor en
 *  ventas (guardado por el pipeline como cuitReceptorEfectivo). */
export function cuitContraparteDe(mov: { origen: string; cuitEmisor: string | null; extraccionRaw: unknown }): string | null {
  if (!esVenta(mov.origen)) return mov.cuitEmisor;
  const raw = mov.extraccionRaw as { cuitReceptorEfectivo?: string } | null;
  return raw?.cuitReceptorEfectivo ?? null;
}
