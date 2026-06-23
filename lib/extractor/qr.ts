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

export async function leerQrAfip(buffer: Buffer): Promise<QrAfip | null> {
  const dir = mkdtempSync(join(tmpdir(), 'qr-'));
  try {
    const pdf = join(dir, 'in.pdf');
    writeFileSync(pdf, buffer);
    // Rasteriza las 2 primeras páginas (el QR suele estar en la 1ª) a 300 dpi.
    execFileSync('pdftoppm', ['-png', '-r', '300', '-f', '1', '-l', '2', pdf, join(dir, 'p')], { stdio: 'ignore' });
    for (const png of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
      let out = '';
      try {
        out = execFileSync('zbarimg', ['--raw', '-q', join(dir, png)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch (e) {
        // zbarimg sale con código 4 cuando no encuentra símbolos; igual capturamos stdout.
        out = String((e as { stdout?: unknown })?.stdout ?? '');
      }
      const line = out
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /\/fe\/qr\/\?p=/.test(l));
      if (line) {
        const q = parseAfipQrUrl(line);
        if (q) return q;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
