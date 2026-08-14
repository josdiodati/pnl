// Alta automática de contraparte durante la ingesta (decisión pura).
//
// El ancla es el QR de ARCA: es la fuente autoritativa de la IDENTIDAD (el CUIT
// del emisor, y el del receptor cuando tipoDocRec = 80). Sin QR no se toca el
// maestro — el comprobante queda sin contraparte y flageado para que lo resuelva
// un humano en la validación.
//
// El QR NO trae razón social (RG 4892: cuit, ptoVta, tipoCmp, nroCmp, importe,
// moneda, ctz, tipoDocRec, nroDocRec, tipoCodAut, codAut), así que el nombre sale
// de la extracción del LLM. Eso no puede duplicar contrapartes: Contraparte es
// única por (empresaId, cuit), de modo que la identidad la fija el QR y el nombre
// es solo una etiqueta editable en el maestro.

export type EntradaAltaContraparte = {
  direccion: 'COMPRA' | 'VENTA';
  /** Emisor en compras, receptor en ventas; ya normalizado. */
  cuitContraparte: string | null;
  /** Ese CUIT lo aportó el QR (no el LLM). */
  cuitDesdeQr: boolean;
  razonSocialEmisor: string | null;
  razonSocialReceptor: string | null;
  yaExiste: boolean;
  /** Datos de la propia empresa, para detectar la inversión de roles del LLM. */
  razonSocialEmpresa?: string | null;
  cuitEmpresa?: string | null;
};

export type DecisionAltaContraparte =
  | { crear: false; motivo: string }
  | { crear: true; cuit: string; razonSocial: string; tipo: 'PROVEEDOR' | 'CLIENTE' };

function limpiar(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Nombre comparable: sin mayúsculas, puntos, comas ni espacios de más.
 *  "EWWO CONSULTING S.R.L." y "Ewwo Consulting SRL" son el mismo. */
export function claveNombre(v: string | null | undefined): string | null {
  const t = limpiar(v);
  return t ? t.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}

/** Una contraparte no puede ser la propia empresa. Misma regla que usa el alta
 *  automática, para que la prevención y la limpieza no puedan divergir. */
export function esLaPropiaEmpresa(
  contraparte: { cuit: string | null; razonSocial: string | null },
  empresa: { cuit: string | null; razonSocial: string | null },
): boolean {
  const cuitEmpresa = limpiar(empresa.cuit);
  if (cuitEmpresa && limpiar(contraparte.cuit) === cuitEmpresa) return true;
  const nombreEmpresa = claveNombre(empresa.razonSocial);
  return Boolean(nombreEmpresa && claveNombre(contraparte.razonSocial) === nombreEmpresa);
}

export function decidirAltaContraparte(e: EntradaAltaContraparte): DecisionAltaContraparte {
  if (e.yaExiste) return { crear: false, motivo: 'ya está en el maestro' };
  if (!e.cuitContraparte) return { crear: false, motivo: 'sin CUIT de contraparte' };
  if (!e.cuitDesdeQr) return { crear: false, motivo: 'el CUIT no vino del QR' };

  // La contraparte nunca puede ser la propia empresa.
  if (limpiar(e.cuitEmpresa) && e.cuitContraparte === limpiar(e.cuitEmpresa)) {
    return { crear: false, motivo: 'el CUIT es el de la propia empresa' };
  }

  const esVenta = e.direccion === 'VENTA';
  const razonSocial = limpiar(esVenta ? e.razonSocialReceptor : e.razonSocialEmisor);
  if (!razonSocial) return { crear: false, motivo: 'sin razón social extraída' };

  // El LLM invirtió emisor y receptor: el nombre que ofrece es el nuestro, no el
  // de la contraparte. El QR ya corrigió el CUIT, pero no puede corregir el
  // nombre porque no lo trae — así que no hay etiqueta confiable que poner.
  const claveEmpresa = claveNombre(e.razonSocialEmpresa);
  if (claveEmpresa && claveNombre(razonSocial) === claveEmpresa) {
    return { crear: false, motivo: 'el nombre extraído es el de la propia empresa (el LLM invirtió emisor y receptor)' };
  }

  return { crear: true, cuit: e.cuitContraparte, razonSocial, tipo: esVenta ? 'CLIENTE' : 'PROVEEDOR' };
}
