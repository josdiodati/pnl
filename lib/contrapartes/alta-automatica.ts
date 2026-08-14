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
};

export type DecisionAltaContraparte =
  | { crear: false; motivo: string }
  | { crear: true; cuit: string; razonSocial: string; tipo: 'PROVEEDOR' | 'CLIENTE' };

function limpiar(v: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function decidirAltaContraparte(e: EntradaAltaContraparte): DecisionAltaContraparte {
  if (e.yaExiste) return { crear: false, motivo: 'ya está en el maestro' };
  if (!e.cuitContraparte) return { crear: false, motivo: 'sin CUIT de contraparte' };
  if (!e.cuitDesdeQr) return { crear: false, motivo: 'el CUIT no vino del QR' };

  const esVenta = e.direccion === 'VENTA';
  const razonSocial = limpiar(esVenta ? e.razonSocialReceptor : e.razonSocialEmisor);
  if (!razonSocial) return { crear: false, motivo: 'sin razón social extraída' };

  return { crear: true, cuit: e.cuitContraparte, razonSocial, tipo: esVenta ? 'CLIENTE' : 'PROVEEDOR' };
}
