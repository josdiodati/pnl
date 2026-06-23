// Cross-check del QR de AFIP (RG 4892). SOLO verificación: nunca bloquea el
// pipeline. parseAfipQrUrl es puro y testeable; leerQrAfip es best-effort sobre
// el PDF (rasteriza la 1ª página y decodifica el QR) y devuelve null ante
// cualquier fallo, ausencia de QR o falta de dependencia opcional.

export type QrAfip = {
  ver: number;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;
  ctz: number;
  codAut: number;
  tipoCodAut: string;
};

export function parseAfipQrUrl(url: string): QrAfip | null {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)afip\.gob\.ar$/i.test(u.hostname)) return null;
    const p = u.searchParams.get('p');
    if (!p) return null;
    const json = Buffer.from(p, 'base64').toString('utf8');
    const data = JSON.parse(json);
    if (typeof data?.cuit !== 'number' || typeof data?.codAut !== 'number') return null;
    return data as QrAfip;
  } catch {
    return null;
  }
}

export async function leerQrAfip(buffer: Buffer): Promise<QrAfip | null> {
  try {
    const url = await decodificarQrDesdePdf(buffer);
    return url ? parseAfipQrUrl(url) : null;
  } catch {
    return null;
  }
}

// Rasteriza la 1ª página y busca un QR. Aislado y best-effort: si la dependencia
// de decodificación no está disponible, devuelve null sin romper.
async function decodificarQrDesdePdf(buffer: Buffer): Promise<string | null> {
  try {
    const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const png = await renderPageAsImage(doc, 1, { scale: 2 });
    if (!png) return null;
    const jsqr = (await import('jsqr')).default;
    const { decodePngToRgba } = await import('./png');
    const { data, width, height } = await decodePngToRgba(Buffer.from(png as ArrayBuffer));
    const result = jsqr(new Uint8ClampedArray(data), width, height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}
