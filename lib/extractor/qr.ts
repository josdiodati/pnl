import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// QR de comprobantes fiscales (RG 4892). AFIP se renombró ARCA: el QR apunta a
// arca.gob.ar (o afip.gob.ar en comprobantes viejos), ambos válidos.
//
// El QR es la fuente AUTORITATIVA del encabezado: trae cuit (emisor), receptor
// (nroDocRec), importe total, punto de venta, número y CAE (codAut). Se usa para
// corregir lo que el LLM extrae con ruido (dirección, montos, CUITs).
//
// parseAfipQrUrl es puro y testeable. leerQrAfip es best-effort: rasteriza con
// pdftoppm (poppler-utils) y decodifica con zbarimg (zbar-tools); ante cualquier
// fallo o ausencia de binarios devuelve null — nunca lanza ni bloquea.

export type QrAfip = {
  ver: number;
  fecha: string;
  cuit: number; // CUIT del EMISOR
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number; // total del comprobante
  moneda: string;
  ctz: number;
  tipoDocRec?: number; // 80 = CUIT
  nroDocRec?: number; // documento del RECEPTOR
  tipoCodAut: string;
  codAut: number; // CAE
};

export function parseAfipQrUrl(url: string): QrAfip | null {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)(afip|arca)\.gob\.ar$/i.test(u.hostname)) return null;
    const p = u.searchParams.get('p');
    if (!p) return null;
    const data = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    if (typeof data?.cuit !== 'number') return null;
    return data as QrAfip;
  } catch {
    return null;
  }
}

// Estado del QR para el marcador en validación:
// - OK: tiene QR y se pudo leer e interpretar como QR de ARCA/AFIP.
// - ILEGIBLE: tiene un símbolo QR pero no se pudo usar (no es de ARCA/AFIP, corrupto, o falló el decode).
// - SIN_QR: no se detectó ningún símbolo QR en el documento.
export type EstadoQr = 'OK' | 'ILEGIBLE' | 'SIN_QR';
export type ResultadoQr = { qr: QrAfip | null; estado: EstadoQr };

// Corre zbarimg sobre un PNG y devuelve las URLs de los símbolos QR encontrados.
// Sin --raw: zbarimg prefija cada símbolo con su tipo ("QR-Code:..."), así
// distinguimos un QR de otros códigos (databar/barras 1D).
function zbarQrUrls(pngPath: string): string[] {
  let out = '';
  try {
    out = execFileSync('zbarimg', ['-q', pngPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // zbarimg sale con código 4 cuando no encuentra símbolos; igual capturamos stdout.
    out = String((e as { stdout?: unknown })?.stdout ?? '');
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('QR-Code:'))
    .map((l) => l.slice('QR-Code:'.length));
}

export async function leerQrAfip(buffer: Buffer): Promise<ResultadoQr> {
  const dir = mkdtempSync(join(tmpdir(), 'qr-'));
  let tieneSimboloQr = false;
  // Prueba zbar sobre un PNG; marca si vio algún QR y devuelve el primero que parsea como ARCA/AFIP.
  const probar = (png: string): QrAfip | null => {
    for (const url of zbarQrUrls(png)) {
      tieneSimboloQr = true;
      const q = parseAfipQrUrl(url);
      if (q) return q;
    }
    return null;
  };
  try {
    const pdf = join(dir, 'in.pdf');
    writeFileSync(pdf, buffer);

    // Paso 1: render normal de las 2 primeras páginas a 300 dpi (caso común).
    execFileSync('pdftoppm', ['-png', '-r', '300', '-f', '1', '-l', '2', pdf, join(dir, 'p')], { stdio: 'ignore' });
    for (const png of readdirSync(dir).filter((f) => /^p-.*\.png$/.test(f))) {
      const q = probar(join(dir, png));
      if (q) return { qr: q, estado: 'OK' };
    }

    // Paso 2 (fallback): muchos QR no los lee zbar por el anti-aliasing del render.
    // Binarizamos la página 1 a 400 dpi (gris + threshold) con ImageMagick y reintentamos.
    execFileSync('pdftoppm', ['-png', '-r', '400', '-f', '1', '-l', '1', pdf, join(dir, 'hi')], { stdio: 'ignore' });
    const hi = readdirSync(dir).find((f) => /^hi-.*\.png$/.test(f));
    if (hi) {
      for (const th of ['50%', '55%', '60%']) {
        const thp = join(dir, `th${th.replace('%', '')}.png`);
        try {
          execFileSync('convert', [join(dir, hi), '-colorspace', 'Gray', '-threshold', th, thp], { stdio: 'ignore' });
        } catch {
          continue; // sin ImageMagick: el fallback queda inactivo (best-effort)
        }
        const q = probar(thp);
        if (q) return { qr: q, estado: 'OK' };
      }
    }

    return { qr: null, estado: tieneSimboloQr ? 'ILEGIBLE' : 'SIN_QR' };
  } catch {
    return { qr: null, estado: tieneSimboloQr ? 'ILEGIBLE' : 'SIN_QR' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
