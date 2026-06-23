# Captura real de comprobantes — Etapa 1 · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasar la captura de comprobantes de mock a real sobre los datos reales de Kawellu, con detección venta/compra, cross-check de QR AFIP, gate de ARCA con override, seed real e import masivo, dejando los comprobantes procesados en la cola de validación.

**Architecture:** Se reutiliza el pipeline multicanal existente (`lib/pipeline.ts`), la abstracción `DocumentExtractor` (branch texto-vs-visión ya implementado) y la capa de servicio de movimientos. Se refina el extractor Anthropic, se agrega un módulo de QR best-effort, se extiende el modelo de datos con un nuevo origen `VENTA_COMPROBANTE`, se endurece el gate de ARCA en la validación, y se reemplaza el seed demo por uno real con un script de import masivo.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + Postgres, `@anthropic-ai/sdk`, `unpdf`, vitest, tsx.

## Global Constraints

- Modelo LLM por defecto: `claude-opus-4-8` (configurable por `EXTRACTOR_MODEL`). Copiado verbatim de la spec.
- Sin credenciales: con `EXTRACTOR_MODE` distinto de `real` o sin `ANTHROPIC_API_KEY`, el sistema cae a mock (no romper este invariante, ya implementado en `lib/extractor/index.ts`).
- El QR es **solo verificación**: nunca bloquea ni rompe el pipeline si no existe o no se puede decodificar.
- ARCA en modo mock por defecto (`ARCA_MODE=mock`); el flujo de override es real.
- Todo override de ARCA queda auditado vía `writeAudit`.
- Tests con `vitest` (`npm test`); alias de imports `@/` → raíz del repo.
- Importes siempre positivos en la extracción; el signo se deriva después.
- CUIT: 11 dígitos sin guiones (usar `normalizarCuit`).

---

## File Structure

- `lib/extractor/schema.ts` — MODIFICAR: agregar `cuitReceptor`, `razonSocialReceptor`, `esComprobanteFiscalArg`.
- `lib/extractor/anthropic.ts` — MODIFICAR: modelo por defecto `claude-opus-4-8`, prompt para receptor + flag fiscal.
- `lib/extractor/qr.ts` — CREAR: parser puro de QR AFIP + lectura best-effort desde PDF.
- `prisma/schema.prisma` — MODIFICAR: agregar `VENTA_COMPROBANTE` al enum `OrigenMovimiento`.
- `lib/pipeline.ts` — MODIFICAR: detección dirección venta/compra + cross-check QR + matching por receptor en ventas.
- `lib/movimientos/service.ts` — MODIFICAR: gate de ARCA (require VALIDO salvo override) + `overrideNoFiscal`.
- `app/(app)/[empresaSlug]/validacion/actions.ts` — MODIFICAR: leer `overrideNoFiscal` y motivo del form.
- `components/validacion-form.tsx` — MODIFICAR: UI del override no-fiscal.
- `prisma/seed.ts` — REEMPLAZAR: seed real (Jose Diodati + Kawellu + Ewwo).
- `scripts/import-comprobantes.ts` — CREAR: import masivo de `Docs/ComprobantesEjemplos/`.
- Tests: `tests/extractor-schema.test.ts`, `tests/qr.test.ts`, `tests/direccion.test.ts`, `tests/arca-gate.test.ts`.

---

## Task 1: Extender el schema de extracción

**Files:**
- Modify: `lib/extractor/schema.ts`
- Test: `tests/extractor-schema.test.ts`

**Interfaces:**
- Produces: `Extraccion` ahora incluye `cuitReceptor: string | null`, `razonSocialReceptor: string | null`, `esComprobanteFiscalArg: boolean`. `extraccionJsonSchema` agrega esas propiedades y `esComprobanteFiscalArg` a `required`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/extractor-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extraccionSchema } from '@/lib/extractor/schema';

describe('extraccionSchema: campos de receptor y flag fiscal', () => {
  it('parsea un comprobante con receptor y flag fiscal', () => {
    const e = extraccionSchema.parse({
      tipoComprobante: 'FACTURA_A',
      total: 1210,
      moneda: 'ARS',
      cuitReceptor: '30718332148',
      razonSocialReceptor: 'Kawellu Soluciones S.R.L.',
      esComprobanteFiscalArg: true,
    });
    expect(e.cuitReceptor).toBe('30718332148');
    expect(e.razonSocialReceptor).toBe('Kawellu Soluciones S.R.L.');
    expect(e.esComprobanteFiscalArg).toBe(true);
  });

  it('toma defaults cuando faltan los campos nuevos', () => {
    const e = extraccionSchema.parse({ tipoComprobante: 'TICKET', total: 100, moneda: 'ARS' });
    expect(e.cuitReceptor).toBeNull();
    expect(e.razonSocialReceptor).toBeNull();
    expect(e.esComprobanteFiscalArg).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/extractor-schema.test.ts`
Expected: FAIL (los campos nuevos no existen / `esComprobanteFiscalArg` indefinido).

- [ ] **Step 3: Implementar los campos en el schema**

En `lib/extractor/schema.ts`, dentro del objeto `extraccionSchema` (después de `vencimientoCae`, antes de `confianza`):

```typescript
  cuitReceptor: z.string().nullable().default(null),
  razonSocialReceptor: z.string().nullable().default(null),
  esComprobanteFiscalArg: z.boolean().default(false),
```

Y en `extraccionJsonSchema.properties` (después de `vencimientoCae`):

```typescript
    cuitReceptor: { type: ['string', 'null'], description: 'CUIT del receptor, solo dígitos' },
    razonSocialReceptor: { type: ['string', 'null'] },
    esComprobanteFiscalArg: {
      type: 'boolean',
      description: 'true si es comprobante fiscal argentino (factura/NC/ND/ticket con CAE); false si es invoice extranjero o no fiscal (AWS, Claude, Google, etc.)',
    },
```

Y agregar `esComprobanteFiscalArg` al array `required`:

```typescript
  required: ['tipoComprobante', 'total', 'moneda', 'esComprobanteFiscalArg'],
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/extractor-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/extractor/schema.ts tests/extractor-schema.test.ts
git commit -m "feat(extractor): receptor + flag fiscal en el schema de extracción"
```

---

## Task 2: Modelo opus-4-8 y prompt para receptor + flag fiscal

**Files:**
- Modify: `lib/extractor/anthropic.ts:24` (modelo) y `lib/extractor/anthropic.ts:12-20` (system prompt)

**Interfaces:**
- Consumes: `Extraccion` (Task 1).
- Produces: ningún cambio de firma; el `AnthropicExtractor` ahora pide receptor y flag fiscal y usa `claude-opus-4-8` por defecto.

- [ ] **Step 1: Cambiar el modelo por defecto**

En `lib/extractor/anthropic.ts`, reemplazar la línea 24:

```typescript
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-sonnet-4-6';
```

por:

```typescript
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';
```

- [ ] **Step 2: Ampliar el system prompt**

En `lib/extractor/anthropic.ts`, agregar al final del template `SYSTEM_PROMPT` (después de la última línea de reglas, antes del backtick de cierre):

```
- Extraé también el RECEPTOR del comprobante (cuitReceptor, razonSocialReceptor): es a nombre de quién se emite.
- Marcá "esComprobanteFiscalArg" en true SOLO si es un comprobante fiscal argentino (factura/nota de crédito/débito/ticket con CAE). Para invoices de servicios extranjeros que no emiten comprobante fiscal argentino (AWS, Anthropic/Claude, Google, etc.), poné false.
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/extractor/anthropic.ts
git commit -m "feat(extractor): modelo opus-4-8 + extracción de receptor y flag fiscal"
```

---

## Task 3: Cross-check de QR AFIP (best-effort)

**Files:**
- Create: `lib/extractor/qr.ts`
- Test: `tests/qr.test.ts`

**Interfaces:**
- Produces:
  - `type QrAfip = { ver: number; fecha: string; cuit: number; ptoVta: number; tipoCmp: number; nroCmp: number; importe: number; moneda: string; ctz: number; codAut: number; tipoCodAut: string }`
  - `parseAfipQrUrl(url: string): QrAfip | null` — parser puro (decodifica el `?p=<base64 json>`).
  - `leerQrAfip(buffer: Buffer): Promise<QrAfip | null>` — best-effort: rasteriza la 1ª página del PDF y decodifica el QR; devuelve `null` ante cualquier fallo o ausencia.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/qr.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAfipQrUrl } from '@/lib/extractor/qr';

// JSON real de ejemplo del estándar de QR de AFIP (RG 4892).
const PAYLOAD = {
  ver: 1, fecha: '2026-06-01', cuit: 30718332148, ptoVta: 1, tipoCmp: 1,
  nroCmp: 349, importe: 1874379.54, moneda: 'PES', ctz: 1, tipoDocRec: 80,
  nroDocRec: 30709997579, tipoCodAut: 'E', codAut: 86228096232912,
};
const URL = 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(PAYLOAD)).toString('base64');

describe('parseAfipQrUrl', () => {
  it('decodifica un QR de AFIP válido', () => {
    const q = parseAfipQrUrl(URL);
    expect(q).not.toBeNull();
    expect(q!.cuit).toBe(30718332148);
    expect(q!.nroCmp).toBe(349);
    expect(q!.codAut).toBe(86228096232912);
    expect(q!.importe).toBeCloseTo(1874379.54, 2);
  });

  it('devuelve null para una URL que no es de AFIP', () => {
    expect(parseAfipQrUrl('https://example.com/foo')).toBeNull();
  });

  it('devuelve null para un payload corrupto', () => {
    expect(parseAfipQrUrl('https://www.afip.gob.ar/fe/qr/?p=no-es-base64-json')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/qr.test.ts`
Expected: FAIL ("Cannot find module '@/lib/extractor/qr'").

- [ ] **Step 3: Implementar el módulo**

Crear `lib/extractor/qr.ts`:

```typescript
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
    if (!/afip\.gob\.ar$/i.test(u.hostname) && !u.hostname.includes('afip.gob.ar')) return null;
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
```

Nota: `leerQrAfip` está envuelto en try/catch total; si `jsqr`, `unpdf.renderPageAsImage` o `./png` no están disponibles, devuelve `null` y el pipeline simplemente no hace cross-check (comportamiento "no bloquea" de la spec). La implementación de `lib/extractor/png.ts` (decodificar PNG → RGBA) y la instalación de `jsqr` se hacen en el Step 5; si se omiten, el cross-check queda inactivo sin romper nada.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/qr.test.ts`
Expected: PASS (el parser puro no depende del raster).

- [ ] **Step 5: Habilitar el raster del QR (dependencias)**

Instalar la lib de decodificación y crear el helper PNG→RGBA:

```bash
npm install jsqr pngjs
npm install -D @types/pngjs
```

Crear `lib/extractor/png.ts`:

```typescript
import { PNG } from 'pngjs';

export async function decodePngToRgba(
  png: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    new PNG().parse(png, (err, parsed) => {
      if (err) reject(err);
      else resolve({ data: parsed.data, width: parsed.width, height: parsed.height });
    });
  });
}
```

- [ ] **Step 6: Typecheck y test completo**

Run: `npm run typecheck && npm test -- tests/qr.test.ts`
Expected: sin errores; PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/extractor/qr.ts lib/extractor/png.ts tests/qr.test.ts package.json package-lock.json
git commit -m "feat(extractor): cross-check best-effort del QR de AFIP"
```

---

## Task 4: Nuevo origen VENTA_COMPROBANTE en el modelo

**Files:**
- Modify: `prisma/schema.prisma:193-197` (enum `OrigenMovimiento`)

**Interfaces:**
- Produces: enum `OrigenMovimiento` con el valor adicional `VENTA_COMPROBANTE`.

- [ ] **Step 1: Agregar el valor al enum**

En `prisma/schema.prisma`, reemplazar:

```prisma
enum OrigenMovimiento {
  COMPROBANTE
  ASIENTO_MANUAL
  VENTA_MANUAL
}
```

por:

```prisma
enum OrigenMovimiento {
  COMPROBANTE
  VENTA_COMPROBANTE
  ASIENTO_MANUAL
  VENTA_MANUAL
}
```

- [ ] **Step 2: Aplicar el cambio al schema de la base y regenerar el cliente**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema"; cliente Prisma regenerado.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores (el tipo `OrigenMovimiento` ahora incluye el nuevo valor).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(db): origen VENTA_COMPROBANTE para ventas con comprobante"
```

---

## Task 5: Detección dirección venta/compra + QR en el pipeline

**Files:**
- Modify: `lib/pipeline.ts` (función `procesarExtraccion`, líneas ~89-156)
- Test: `tests/direccion.test.ts`

**Interfaces:**
- Consumes: `Extraccion` con `cuitReceptor`/`esComprobanteFiscalArg` (Task 1), `leerQrAfip` (Task 3), origen `VENTA_COMPROBANTE` (Task 4).
- Produces: función pura exportada `clasificarDireccion(cuitEmisor, cuitReceptor, cuitEmpresa): 'COMPRA' | 'VENTA'` usada por el pipeline y testeable sin DB.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/direccion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { clasificarDireccion } from '@/lib/pipeline';

describe('clasificarDireccion', () => {
  const KAWELLU = '30718332148';

  it('es VENTA cuando el emisor es la propia empresa', () => {
    expect(clasificarDireccion(KAWELLU, '30709997579', KAWELLU)).toBe('VENTA');
  });

  it('es COMPRA cuando el emisor es un tercero', () => {
    expect(clasificarDireccion('30582605021', KAWELLU, KAWELLU)).toBe('COMPRA');
  });

  it('es COMPRA por defecto cuando no se puede determinar el emisor', () => {
    expect(clasificarDireccion(null, KAWELLU, KAWELLU)).toBe('COMPRA');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/direccion.test.ts`
Expected: FAIL ("clasificarDireccion is not exported").

- [ ] **Step 3: Implementar `clasificarDireccion` y cablear el pipeline**

En `lib/pipeline.ts`, agregar el import del QR al inicio (junto a los demás imports):

```typescript
import { leerQrAfip } from '@/lib/extractor/qr';
```

Agregar la función pura exportada (cerca del top del archivo, después de los imports):

```typescript
/** Determina si un comprobante es una compra (emisor tercero) o una venta
 *  emitida por la propia empresa (emisor === CUIT de la empresa). */
export function clasificarDireccion(
  cuitEmisor: string | null,
  _cuitReceptor: string | null,
  cuitEmpresa: string | null,
): 'COMPRA' | 'VENTA' {
  if (cuitEmisor && cuitEmpresa && cuitEmisor === cuitEmpresa) return 'VENTA';
  return 'COMPRA';
}
```

Dentro de `procesarExtraccion`, después de calcular `const cuit = ...` (línea ~89) y antes del matching de contraparte, insertar la lógica de dirección + receptor + QR. Reemplazar el bloque de matching de contraparte (líneas ~92-94):

```typescript
  // Matching against the company's contraparte master
  const contraparte = cuit ? await db.contraparte.findFirst({ where: { cuit, activa: true } }) : null;
  if (!contraparte && cuit) camposRevisar.contraparte = 'Contraparte nueva: no está en el maestro';
```

por:

```typescript
  // Dirección: venta (emisor = empresa) vs compra (emisor tercero)
  const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId } });
  const cuitEmpresa = empresa?.cuit ? normalizarCuit(empresa.cuit) : null;
  const cuitReceptor = extraccion.cuitReceptor ? normalizarCuit(extraccion.cuitReceptor) : null;
  const direccion = clasificarDireccion(cuit, cuitReceptor, cuitEmpresa);
  const origenFinal: 'COMPROBANTE' | 'VENTA_COMPROBANTE' =
    direccion === 'VENTA' ? 'VENTA_COMPROBANTE' : 'COMPROBANTE';

  // En ventas, la contraparte es el RECEPTOR (cliente); en compras, el EMISOR (proveedor).
  const cuitContraparte = direccion === 'VENTA' ? cuitReceptor : cuit;
  const contraparte = cuitContraparte
    ? await db.contraparte.findFirst({ where: { cuit: cuitContraparte, activa: true } })
    : null;
  if (!contraparte && cuitContraparte) {
    camposRevisar.contraparte = 'Contraparte nueva: no está en el maestro';
  }

  // Cross-check best-effort del QR de AFIP (solo verificación, no bloquea)
  let qrAfip: unknown = null;
  if (mov.archivoMime === 'application/pdf') {
    const qr = await leerQrAfip(buffer);
    if (qr) {
      qrAfip = qr;
      const difs: string[] = [];
      if (cuit && String(qr.cuit) !== cuit) difs.push('CUIT emisor');
      if (extraccion.numero && Number(extraccion.numero) !== qr.nroCmp) difs.push('número');
      if (extraccion.total != null && Math.abs(qr.importe - extraccion.total) > 1) difs.push('importe');
      if (extraccion.cae && qr.codAut && extraccion.cae !== String(qr.codAut)) difs.push('CAE');
      if (difs.length) camposRevisar.qr = `QR AFIP no coincide: ${difs.join(', ')}`;
    }
  }
```

En el `db.movimiento.update` (líneas ~126-156), agregar `origen: origenFinal` al objeto `data` (justo después de `estado: estadoFinal,`), y guardar el QR dentro de `extraccionRaw`. Reemplazar:

```typescript
      extraccionRaw: extraccion as never,
```

por:

```typescript
      origen: origenFinal,
      extraccionRaw: { ...extraccion, qrAfip } as never,
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/direccion.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline.ts tests/direccion.test.ts
git commit -m "feat(pipeline): dirección venta/compra + cross-check de QR"
```

---

## Task 6: Gate de ARCA con override no-fiscal

**Files:**
- Modify: `lib/movimientos/service.ts` (tipo `DatosValidacion` ~75-92 y `validarMovimiento` ~114-118)
- Modify: `app/(app)/[empresaSlug]/validacion/actions.ts` (~99-101)
- Modify: `components/validacion-form.tsx` (~128-138)
- Test: `tests/arca-gate.test.ts`

**Interfaces:**
- Consumes: `mov.arcaEstado` (`NO_VERIFICADO|VALIDO|INVALIDO|ERROR_CONSULTA`).
- Produces:
  - `DatosValidacion` gana `overrideNoFiscal?: boolean` y `overrideNoFiscalMotivo?: string | null`.
  - función pura exportada `puedeValidarArca(arcaEstado, opts): { ok: boolean; motivo?: string }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/arca-gate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { puedeValidarArca } from '@/lib/movimientos/service';

describe('puedeValidarArca: gate de ARCA con override', () => {
  it('permite validar cuando ARCA es VALIDO', () => {
    expect(puedeValidarArca('VALIDO', {}).ok).toBe(true);
  });

  it('bloquea INVALIDO sin confirmación', () => {
    expect(puedeValidarArca('INVALIDO', {}).ok).toBe(false);
  });

  it('permite INVALIDO con confirmarArcaInvalido', () => {
    expect(puedeValidarArca('INVALIDO', { confirmarArcaInvalido: true }).ok).toBe(true);
  });

  it('bloquea NO_VERIFICADO sin override', () => {
    expect(puedeValidarArca('NO_VERIFICADO', {}).ok).toBe(false);
  });

  it('permite NO_VERIFICADO con override no-fiscal + motivo', () => {
    const r = puedeValidarArca('NO_VERIFICADO', { overrideNoFiscal: true, overrideNoFiscalMotivo: 'Servicio AWS sin comprobante AR' });
    expect(r.ok).toBe(true);
  });

  it('bloquea override no-fiscal sin motivo', () => {
    expect(puedeValidarArca('NO_VERIFICADO', { overrideNoFiscal: true }).ok).toBe(false);
  });

  it('aplica el override no-fiscal también a ERROR_CONSULTA', () => {
    expect(puedeValidarArca('ERROR_CONSULTA', { overrideNoFiscal: true, overrideNoFiscalMotivo: 'x' }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/arca-gate.test.ts`
Expected: FAIL ("puedeValidarArca is not exported").

- [ ] **Step 3: Implementar el gate puro y extender `DatosValidacion`**

En `lib/movimientos/service.ts`, agregar la función pura (después de los imports, antes de `snapshot`):

```typescript
/** Gate de ARCA: un comprobante solo se valida si ARCA dice VALIDO, salvo override. */
export function puedeValidarArca(
  arcaEstado: string,
  opts: { confirmarArcaInvalido?: boolean; overrideNoFiscal?: boolean; overrideNoFiscalMotivo?: string | null },
): { ok: boolean; motivo?: string } {
  if (arcaEstado === 'VALIDO') return { ok: true };
  if (arcaEstado === 'INVALIDO') {
    return opts.confirmarArcaInvalido
      ? { ok: true }
      : { ok: false, motivo: 'Este comprobante figura como INVÁLIDO en ARCA. Para validarlo igual tenés que marcar la confirmación explícita.' };
  }
  // NO_VERIFICADO | ERROR_CONSULTA (sin CAE / no fiscal / extranjero)
  if (opts.overrideNoFiscal) {
    return opts.overrideNoFiscalMotivo && opts.overrideNoFiscalMotivo.trim()
      ? { ok: true }
      : { ok: false, motivo: 'El override de un comprobante no constatable por ARCA requiere un motivo.' };
  }
  return { ok: false, motivo: 'Este comprobante no está constatado como válido por ARCA. Marcá el override (no fiscal / extranjero) con un motivo para validarlo igual.' };
}
```

En el tipo `DatosValidacion`, agregar (después de `confirmarArcaInvalido?: boolean;`):

```typescript
  /** Override para comprobantes no constatables por ARCA (no fiscales / extranjeros). Requiere motivo. */
  overrideNoFiscal?: boolean;
  overrideNoFiscalMotivo?: string | null;
```

En `validarMovimiento`, reemplazar el bloque actual del gate (líneas ~114-118):

```typescript
  if (mov.arcaEstado === 'INVALIDO' && !datos.confirmarArcaInvalido) {
    throw new DomainError(
      'Este comprobante figura como INVÁLIDO en ARCA. Para validarlo igual tenés que marcar la confirmación explícita.',
    );
  }
```

por:

```typescript
  // Gate de ARCA: solo aplica a comprobantes (no a asientos/ventas manuales sin archivo).
  if (mov.origen === 'COMPROBANTE' || mov.origen === 'VENTA_COMPROBANTE') {
    const gate = puedeValidarArca(mov.arcaEstado, {
      confirmarArcaInvalido: datos.confirmarArcaInvalido,
      overrideNoFiscal: datos.overrideNoFiscal,
      overrideNoFiscalMotivo: datos.overrideNoFiscalMotivo,
    });
    if (!gate.ok) throw new DomainError(gate.motivo ?? 'No se puede validar por estado de ARCA.');
  }
```

En el `writeAudit` del `validarMovimiento` (objeto `despues`, líneas ~160-164), reemplazar:

```typescript
      ...(mov.arcaEstado === 'INVALIDO' ? { arcaInvalidoConfirmadoPorValidador: true } : {}),
```

por:

```typescript
      ...(mov.arcaEstado === 'INVALIDO' ? { arcaInvalidoConfirmadoPorValidador: true } : {}),
      ...(datos.overrideNoFiscal ? { overrideNoFiscal: true, overrideNoFiscalMotivo: datos.overrideNoFiscalMotivo ?? null } : {}),
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/arca-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Leer el override en la server action**

En `app/(app)/[empresaSlug]/validacion/actions.ts`, dentro de la llamada a `validarMovimiento`, después de la línea `confirmarArcaInvalido: formData.get('confirmarArcaInvalido') === 'on',`:

```typescript
      overrideNoFiscal: formData.get('overrideNoFiscal') === 'on',
      overrideNoFiscalMotivo: String(formData.get('overrideNoFiscalMotivo') ?? '').trim() || null,
```

- [ ] **Step 6: Agregar la UI del override no-fiscal**

En `components/validacion-form.tsx`, justo después del bloque `{mov.arcaEstado === 'INVALIDO' && (...)}` (línea ~138), agregar:

```tsx
      {(mov.arcaEstado === 'NO_VERIFICADO' || mov.arcaEstado === 'ERROR_CONSULTA') && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
          <p>
            ⚠ <strong>ARCA: no constatado.</strong> Este comprobante no figura como válido en ARCA
            (sin CAE, no fiscal o servicio extranjero como AWS / Claude / Google).
          </p>
          <label className="flex items-start gap-2 font-medium">
            <input type="checkbox" name="overrideNoFiscal" className="mt-0.5" />
            Lo valido igual con override (no fiscal / extranjero). Queda registrado en auditoría.
          </label>
          <input
            type="text"
            name="overrideNoFiscalMotivo"
            placeholder="Motivo del override (obligatorio)"
            className="input w-full"
          />
        </div>
      )}
```

- [ ] **Step 7: Typecheck y test completo**

Run: `npm run typecheck && npm test`
Expected: sin errores; todos los tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/movimientos/service.ts "app/(app)/[empresaSlug]/validacion/actions.ts" components/validacion-form.tsx tests/arca-gate.test.ts
git commit -m "feat(validacion): gate de ARCA con override no-fiscal auditado"
```

---

## Task 7: Seed real (Jose Diodati + Kawellu + Ewwo)

**Files:**
- Modify (reemplazar contenido): `prisma/seed.ts`

**Interfaces:**
- Produces: usuario `jose.diodati@gmail.com` admin de Kawellu (`30718332148`) y Ewwo (CUIT placeholder válido), con maestros mínimos por empresa y sin movimientos demo.

- [ ] **Step 1: Reemplazar el seed por el seed real**

Reemplazar TODO el contenido de `prisma/seed.ts` por:

```typescript
// Seed real (etapa captura de comprobantes): un usuario real administrador de
// dos empresas reales, con maestros mínimos. Los movimientos reales entran por
// el import masivo (scripts/import-comprobantes.ts), no por el seed.
// Run: npx prisma db seed   (idempotente: salta si ya existe el usuario).
import { PrismaClient, type TipoCategoria } from '@prisma/client';
import { hashPassword } from '../lib/auth/password';

const prisma = new PrismaClient();

const PASSWORD_DEMO = 'kawellu1234'; // documentado en README; cambiar tras el primer login

const NOMBRES_CATEGORIAS: [string, TipoCategoria][] = [
  ['Ventas Servicios', 'INGRESO'],
  ['Ventas Hardware', 'INGRESO'],
  ['Sueldos', 'EGRESO'],
  ['Adicionales Salarios', 'EGRESO'],
  ['IT & COM Services', 'EGRESO'],
  ['Office Supplies', 'EGRESO'],
  ['Office Expenditure', 'EGRESO'],
  ['Combustible y Movilidad', 'EGRESO'],
  ['Representación', 'EGRESO'],
  ['Legales', 'EGRESO'],
  ['Contables', 'EGRESO'],
  ['Impuestos', 'EGRESO'],
  ['Gastos Bancarios', 'EGRESO'],
  ['Servicios Cloud / SaaS', 'EGRESO'],
  ['Misceláneos', 'EGRESO'],
];

async function crearMaestros(empresaId: string) {
  for (const [nombre, tipo] of NOMBRES_CATEGORIAS) {
    await prisma.categoria.create({ data: { empresaId, nombre, tipo } });
  }
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } });
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'SF', tipo: 'NEGOCIO' } });
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'Administración', tipo: 'SOPORTE' } });
}

async function main() {
  const EMAIL = 'jose.diodati@gmail.com';
  if (await prisma.usuario.findUnique({ where: { email: EMAIL } })) {
    console.log('El seed ya fue aplicado (existe %s). Nada que hacer.', EMAIL);
    return;
  }

  const passwordHash = await hashPassword(PASSWORD_DEMO);
  const jose = await prisma.usuario.create({
    data: { email: EMAIL, nombre: 'Jose Diodati', passwordHash },
  });

  const kawellu = await prisma.empresa.create({
    data: {
      slug: 'kawellu',
      razonSocial: 'Kawellu Soluciones S.R.L.',
      cuit: '30718332148',
      inicioEjercicioFiscal: 1,
      usuarios: { create: [{ usuarioId: jose.id, rol: 'ADMINISTRADOR' }] },
    },
  });

  // CUIT placeholder VÁLIDO (dígito verificador correcto). Editar en Configuración.
  const ewwo = await prisma.empresa.create({
    data: {
      slug: 'ewwo',
      razonSocial: 'Ewwo Consulting S.R.L.',
      cuit: '30712093486',
      inicioEjercicioFiscal: 1,
      usuarios: { create: [{ usuarioId: jose.id, rol: 'ADMINISTRADOR' }] },
    },
  });

  await crearMaestros(kawellu.id);
  await crearMaestros(ewwo.id);

  console.log('Seed real aplicado ✔');
  console.log('  Usuario: %s (password: %s) — admin de Kawellu y Ewwo', EMAIL, PASSWORD_DEMO);
  console.log('  Empresas: kawellu (CUIT 30718332148), ewwo (CUIT placeholder 30712093486 — editar en Configuración)');
  console.log('  Maestros mínimos creados. Cargá comprobantes reales con: npx tsx scripts/import-comprobantes.ts kawellu');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Nota: el CUIT `30712093486` se usa como placeholder válido (aparece en comprobantes EWWO de la carpeta de ejemplos); si no corresponde al CUIT fiscal real de Ewwo, editarlo desde Configuración.

- [ ] **Step 2: Resetear la base y aplicar el seed real**

Run: `npm run db:push -- --force-reset && npm run db:seed`
Expected: la base queda con Jose Diodati + Kawellu + Ewwo + maestros; log "Seed real aplicado ✔".

- [ ] **Step 3: Verificar login y empresas (manual rápido)**

Run: `npm run dev` (en otra terminal) y abrir la app; iniciar sesión con `jose.diodati@gmail.com` / `kawellu1234`; confirmar que el selector muestra Kawellu y Ewwo. Detener el dev al terminar.
Expected: login OK, ambas empresas visibles con rol Administrador.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): seed real Jose Diodati + Kawellu + Ewwo"
```

---

## Task 8: Script de import masivo

**Files:**
- Create: `scripts/import-comprobantes.ts`

**Interfaces:**
- Consumes: `ingestarComprobante` (`lib/pipeline.ts`), `resolverCreadorCanal` (`lib/pipeline.ts`), la cola de jobs (`lib/jobs.ts`), `procesarExtraccion`/`procesarArca` (`lib/pipeline.ts`).
- Produces: ejecutable `npx tsx scripts/import-comprobantes.ts <slugEmpresa> [carpeta]` que ingesta todos los PDFs y drena la cola.

- [ ] **Step 1: Crear el script**

Crear `scripts/import-comprobantes.ts`:

```typescript
// Import masivo de comprobantes reales por el MISMO pipeline que la web.
// Uso: npx tsx scripts/import-comprobantes.ts <slugEmpresa> [carpeta]
// Por defecto la carpeta es Docs/ComprobantesEjemplos. Idempotente: el pipeline
// deduplica por hash de archivo, así que reejecutar no duplica movimientos.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../lib/db';
import { ingestarComprobante, resolverCreadorCanal } from '../lib/pipeline';
import { claimNextJob, completeJob, failJob } from '../lib/jobs';
import { procesarExtraccion, procesarArca, marcarErrorProcesamiento } from '../lib/pipeline';

async function drenarCola() {
  // Procesa la cola de jobs hasta vaciarla (extracción + ARCA), en línea.
  for (;;) {
    const job = await claimNextJob();
    if (!job) break;
    const payload = job.payload as never as { movimientoId: string; empresaId: string };
    try {
      if (job.tipo === 'EXTRACCION') await procesarExtraccion(payload);
      else if (job.tipo === 'ARCA') await procesarArca(payload);
      await completeJob(job.id);
    } catch (err) {
      const { final } = await failJob(job, err);
      console.error(`  job ${job.tipo} falló (intento ${job.intentos}):`, err instanceof Error ? err.message : err);
      if (final && job.tipo === 'EXTRACCION') {
        await marcarErrorProcesamiento(payload, err instanceof Error ? err.message : String(err));
      }
    }
  }
}

async function main() {
  const slug = process.argv[2];
  const carpeta = process.argv[3] ?? 'Docs/ComprobantesEjemplos';
  if (!slug) {
    console.error('Uso: npx tsx scripts/import-comprobantes.ts <slugEmpresa> [carpeta]');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { slug } });
  if (!empresa) {
    console.error(`No existe la empresa con slug "${slug}". Corré el seed primero.`);
    process.exit(1);
  }
  const creadorId = await resolverCreadorCanal(empresa.id, null);
  if (!creadorId) {
    console.error('La empresa no tiene administrador para registrar como creador.');
    process.exit(1);
  }

  const files = (await readdir(carpeta)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  console.log(`Importando ${files.length} PDFs a "${slug}" desde ${carpeta} ...`);

  let ingestados = 0;
  for (const f of files) {
    try {
      const buffer = await readFile(join(carpeta, f));
      await ingestarComprobante({
        empresaId: empresa.id,
        usuarioId: creadorId,
        buffer,
        filename: f,
        mime: 'application/pdf',
        canal: 'WEB',
      });
      ingestados++;
    } catch (err) {
      console.error(`  no se pudo ingestar ${f}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Ingestados ${ingestados}/${files.length}. Procesando la cola...`);

  await drenarCola();

  // Resumen
  const porEstado = await prisma.movimiento.groupBy({
    by: ['estado'],
    where: { empresaId: empresa.id },
    _count: true,
  });
  const porOrigen = await prisma.movimiento.groupBy({
    by: ['origen'],
    where: { empresaId: empresa.id },
    _count: true,
  });
  console.log('Por estado:', Object.fromEntries(porEstado.map((r) => [r.estado, r._count])));
  console.log('Por origen:', Object.fromEntries(porOrigen.map((r) => [r.origen, r._count])));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Corrida en modo mock (humo, sin credenciales)**

Run: `npm run db:push -- --force-reset && npm run db:seed && npx tsx scripts/import-comprobantes.ts kawellu`
Expected: log "Ingestados N/N", luego "Por estado" con la mayoría en `PENDIENTE_VALIDACION` (y posiblemente algún `ERROR_PROCESAMIENTO`/`RETENIDO`), y "Por origen" con `COMPROBANTE` (mock no distingue ventas porque inventa el emisor; con modo real aparecerá `VENTA_COMPROBANTE`).

- [ ] **Step 4: Corrida en modo real (opcional, requiere credenciales)**

Run (si hay `ANTHROPIC_API_KEY`): `EXTRACTOR_MODE=real npx tsx scripts/import-comprobantes.ts kawellu`
Expected: extracción real; "Por origen" muestra `COMPROBANTE` (compras) y `VENTA_COMPROBANTE` (ventas emitidas por Kawellu, CUIT 30718332148). Verificar en la cola de validación que un comprobante con texto trae CUIT/tipo/PV/número/CAE y receptor; que un ticket imagen también se extrae.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-comprobantes.ts
git commit -m "feat(scripts): import masivo de comprobantes reales por el pipeline"
```

---

## Self-Review

**1. Spec coverage:**
- A. Motor de extracción (modelo + receptor + flag fiscal) → Tasks 1, 2. ✓
- B. Cross-check de QR → Task 3 (+ integración en Task 5). ✓
- C. Dirección venta/compra (+ enum) → Tasks 4, 5. ✓
- D. Gate de ARCA + override no-fiscal → Task 6. ✓
- E. Seed real → Task 7. ✓
- F. Import masivo → Task 8. ✓
- Manejo del `.aspx`: el script filtra solo `.pdf` (Task 8 Step 1), omitiendo el `.aspx` como dice la spec. ✓
- Criterios de aceptación 1-7 de la spec: 1-2 (Task 8 Step 4 verificación), 3 (Task 3 + 5), 4 (Task 5), 5 (Task 6), 6 (Task 8), 7 (Task 7 Step 3). ✓

**2. Placeholder scan:** Sin "TBD"/"implementar luego". Los CUIT/password placeholder son valores concretos y documentados como editables (decisión de la spec). El raster de QR es best-effort por diseño (no es un placeholder: la función existe y devuelve null si falta la dep).

**3. Type consistency:**
- `clasificarDireccion` (Task 5) — misma firma en test y en pipeline.
- `puedeValidarArca` (Task 6) — misma firma en test, service y action; `DatosValidacion` extendido coincide con lo que arma `validarAction`.
- `Extraccion` (Task 1) — campos `cuitReceptor`/`razonSocialReceptor`/`esComprobanteFiscalArg` usados consistentemente en anthropic.ts (Task 2) y pipeline (Task 5).
- `QrAfip` (Task 3) — `qr.cuit`/`qr.nroCmp`/`qr.importe`/`qr.codAut` usados en el cross-check del pipeline (Task 5).
- `OrigenMovimiento` con `VENTA_COMPROBANTE` (Task 4) — usado como `origenFinal` (Task 5) y en el gate de ARCA (Task 6).

## Limitación conocida (etapa 1)

Los movimientos `VENTA_COMPROBANTE` aparecen en la **cola de validación** (filtra por estado), pero NO en las pantallas de Comprobantes (filtra `origen=COMPROBANTE`) ni Ventas (filtra `origen=VENTA_MANUAL`). Ajustar esos filtros es trabajo de una iteración posterior de UI, fuera del alcance de esta etapa.
