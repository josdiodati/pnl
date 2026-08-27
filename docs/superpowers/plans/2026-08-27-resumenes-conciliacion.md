# Resúmenes de tarjeta/banco + conciliación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sección Registros → Resúmenes: subir resúmenes de tarjeta/banco, extraer sus líneas con LLM, matchearlas contra movimientos existentes (anti-duplicados) y conciliar/imputar/ignorar cada línea desde una bandeja visual.

**Architecture:** Se espejan los patrones ya probados: extracción asíncrona vía `Job` + worker con tool forzado (como recibos), modelos scoped por empresa, servicio con auditoría y guardas de período, matching PURO y testeado (señales monto/fecha/texto), páginas server-rendered con panel por querystring (como Prepagas). La línea imputada crea un `Movimiento` origen `RESUMen`→`RESUMEN` que nace ASIGNADO; la conciliada apunta al movimiento existente sin crear gasto.

**Tech Stack:** Next.js 14 (app router, server actions), Prisma 5 + Postgres, zod, `@anthropic-ai/sdk`, `unpdf`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-resumenes-conciliacion-design.md`

## Global Constraints

- Todo en castellano (dominio, mensajes, UI, tests).
- Importes `Decimal(18,2)`; en memoria centavos enteros; montos de línea FIRMADOS (gasto negativo, crédito positivo) y `monto` (ARS) NULLABLE (consumos USD sin pesificar).
- Cliente scoped: sin `upsert` (findFirst + create/update); modelos hijos por relación se crean con `prisma` global.
- Migraciones aditivas con `npx prisma db push`; commits en castellano sin Co-Authored-By.
- Suite actual: 274 tests verdes — debe seguir verde; `npx tsc --noEmit` y `npm run build` limpios.
- Roles: toda la sección Resúmenes exige VALIDADOR+ (pages con `requireEmpresaPage(slug,'VALIDADOR')`, actions con `requireEmpresa`).
- Los PDFs de ejemplo reales están en `Docs/Resumenes Ejemplo/` (gitignoreados, con espacio en el nombre de carpeta) — sirven para el e2e en dev, NUNCA se commitean.
- Deploy dev: rsync con `--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r` y excludes anclados (runbook en memoria).

---

### Task 1: Schema Prisma + scope + origen RESUMEN

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/empresa/scope.ts` (SCOPED_MODELS/RELATION_SCOPE)
- Modify: `lib/movimientos/estados.ts` (`ESTADOS_INICIALES`)
- Test: `tests/aislamiento-empresa.test.ts` (casos nuevos), `tests/estados.test.ts` (origen RESUMEN)

**Interfaces:**
- Produces: modelos `Resumen`, `ResumenLinea`; enums `TipoResumen`, `EstadoResumen`, `EstadoLineaResumen`; `OrigenMovimiento.RESUMEN`; `Contraparte.descriptoresResumen Json?`; `Movimiento.lineasResumen ResumenLinea[]`.

- [ ] **Step 1: Tests que van a fallar**

En `tests/aislamiento-empresa.test.ts`, dentro del describe unitario:

```ts
  it('scopea los modelos de resúmenes', () => {
    expect(applyEmpresaScope('Resumen', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('ResumenLinea', 'findMany', {}, 'emp1').where).toEqual({
      resumen: { empresaId: 'emp1' },
    });
  });
```

En `tests/estados.test.ts` (junto a los casos de `esEstadoInicialValido`):

```ts
  it('un movimiento imputado desde un resumen nace asignado o validado', () => {
    expect(esEstadoInicialValido('RESUMEN', 'ASIGNADO')).toBe(true);
    expect(esEstadoInicialValido('RESUMEN', 'VALIDADO')).toBe(true);
    expect(esEstadoInicialValido('RESUMEN', 'INGRESADO')).toBe(false);
  });
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/aislamiento-empresa.test.ts tests/estados.test.ts`
Expected: FAIL (modelos/origen inexistentes).

- [ ] **Step 3: Schema**

En `prisma/schema.prisma`:

```prisma
// ---------- Resúmenes de tarjeta y banco (Spec E) ----------

enum TipoResumen {
  TARJETA
  BANCO
}

enum EstadoResumen {
  PROCESANDO
  EXTRAIDO
  ERROR_PROCESAMIENTO
}

enum EstadoLineaResumen {
  PENDIENTE
  SUGERIDA
  CONCILIADA
  IMPUTADA
  IGNORADA
}

model Resumen {
  id             String        @id @default(cuid())
  empresaId      String
  tipo           TipoResumen
  emisor         String // "VISA Santander", "Cuenta Frances"
  periodoId      String
  fechaCierre    DateTime?
  totalDeclarado Decimal?      @db.Decimal(18, 2) // control de completitud
  estado         EstadoResumen @default(PROCESANDO)
  nota           String? // error de extracción u observaciones

  archivoKey    String
  archivoNombre String
  archivoMime   String
  archivoHash   String

  extraccionRaw       Json?
  tokensEntrada       Int?
  tokensSalida        Int?
  tokensCacheCreacion Int?
  tokensCacheLectura  Int?
  modeloExtractor     String?

  empresa  Empresa        @relation(fields: [empresaId], references: [id])
  periodo  Periodo        @relation(fields: [periodoId], references: [id])
  lineas   ResumenLinea[]
  createdAt DateTime      @default(now())

  @@index([empresaId, createdAt])
}

model ResumenLinea {
  id          String             @id @default(cuid())
  resumenId   String
  orden       Int
  fecha       DateTime?
  descriptor  String // tal como viene en el resumen
  monto       Decimal?           @db.Decimal(18, 2) // FIRMADO en ARS; null = consumo USD sin pesificar
  moneda      Moneda             @default(ARS)
  montoOrigen Decimal?           @db.Decimal(18, 2) // importe en moneda origen (TC implícito)
  cuotas      String? // "3/6"
  cuenta      String? // cuenta/tarjeta dentro del PDF (BBVA consolida varias)
  titular     String? // resúmenes de tarjeta agrupan por titular
  estado      EstadoLineaResumen @default(PENDIENTE)
  movimientoId String? // conciliado (existente) o imputado (creado)
  candidatos  Json? // [{movimientoId, score, motivo}] del matching
  motivoIgnorada String?

  resumen    Resumen     @relation(fields: [resumenId], references: [id], onDelete: Cascade)
  movimiento Movimiento? @relation(fields: [movimientoId], references: [id])
  createdAt  DateTime    @default(now())
}
```

Back-relations: `Empresa.resumenes Resumen[]`, `Periodo.resumenes Resumen[]`,
`Movimiento.lineasResumen ResumenLinea[]`. En `Contraparte` agregar
`descriptoresResumen Json?` (lista de strings normalizados). En
`OrigenMovimiento` agregar `RESUMEN`.

- [ ] **Step 4: Scope y estados**

`lib/empresa/scope.ts`: `SCOPED_MODELS` += `'Resumen'`; `RELATION_SCOPE` += `ResumenLinea: (empresaId) => ({ resumen: { empresaId } })`.

`lib/movimientos/estados.ts`, en `ESTADOS_INICIALES`:

```ts
  // Imputado desde una línea de resumen: el resumen es el respaldo documental;
  // nace asignado (imputación completa) o validado (sin distribución).
  RESUMEN: ['ASIGNADO', 'VALIDADO'],
```

- [ ] **Step 5: Aplicar y verificar**

Run: `npx prisma db push && npx prisma generate && npx vitest run tests/aislamiento-empresa.test.ts tests/estados.test.ts && npx tsc --noEmit`
Expected: push aditivo sin warnings, tests PASS, typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/empresa/scope.ts lib/movimientos/estados.ts tests/aislamiento-empresa.test.ts tests/estados.test.ts
git commit -m "feat(resumenes): modelos de resumen y línea con aislamiento y origen RESUMEN"
```

---

### Task 2: Extractor de resúmenes (schema + LLM + mock)

**Files:**
- Create: `lib/extractor/resumen-schema.ts`
- Create: `lib/extractor/resumen.ts`
- Test: `tests/resumen-schema.test.ts`

**Interfaces:**
- Consumes: `UsoTokens` de `lib/extractor/index.ts`; patrón tool-forzado de `lib/extractor/recibo.ts` (leerlo antes de escribir).
- Produces: `resumenExtraccionSchema`, `type ResumenExtraccion`, `getResumenExtractor(): { extract(input: { texto: string | null; buffer: Buffer; mime: string }): Promise<{ extraccion: ResumenExtraccion; uso: UsoTokens | null }> }`.

- [ ] **Step 1: Test del schema (RED)**

`tests/resumen-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resumenExtraccionSchema } from '@/lib/extractor/resumen-schema';

describe('resumenExtraccionSchema', () => {
  it('parsea un resumen de tarjeta con línea USD sin pesificar y titular', () => {
    const r = resumenExtraccionSchema.parse({
      tipo: 'TARJETA',
      emisor: 'Visa Business BBVA',
      periodoAnio: 2026,
      periodoMes: 7,
      fechaCierre: '2026-07-30',
      totalDeclarado: -1376102.08,
      lineas: [
        { fecha: '2026-06-29', descriptor: 'ANTHROPIC* CLAUD', monto: null, moneda: 'USD', montoOrigen: -100, cuenta: null, titular: 'JACINTO DIODATI', cuotas: null },
        { fecha: '2026-07-29', descriptor: 'COMISION MANT. DE CUENTA', monto: -7128.1, moneda: 'ARS', montoOrigen: null, cuenta: null, titular: null, cuotas: null },
      ],
    });
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[0].monto).toBeNull();
    expect(r.lineas[0].montoOrigen).toBe(-100);
  });

  it('parsea un resumen de banco multi-cuenta y una línea positiva (crédito)', () => {
    const r = resumenExtraccionSchema.parse({
      tipo: 'BANCO',
      emisor: 'Mercado Pago',
      periodoAnio: 2026,
      periodoMes: 7,
      lineas: [
        { fecha: '2026-07-01', descriptor: 'Rendimientos', monto: 153.89, moneda: 'ARS', montoOrigen: null, cuenta: 'CVU 0000003100092554367658', titular: null, cuotas: null },
      ],
    });
    expect(r.lineas[0].monto).toBeGreaterThan(0);
    expect(r.totalDeclarado).toBeNull();
  });

  it('un resumen sin movimientos parsea con 0 líneas', () => {
    const r = resumenExtraccionSchema.parse({ tipo: 'BANCO', emisor: 'Santander U$S', periodoAnio: 2026, periodoMes: 7 });
    expect(r.lineas).toEqual([]);
  });

  it('rechaza mes inválido y tipo desconocido', () => {
    expect(() => resumenExtraccionSchema.parse({ tipo: 'OTRO', emisor: 'x', periodoAnio: 2026, periodoMes: 7 })).toThrow();
    expect(() => resumenExtraccionSchema.parse({ tipo: 'BANCO', emisor: 'x', periodoAnio: 2026, periodoMes: 13 })).toThrow();
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run tests/resumen-schema.test.ts` FAIL.

- [ ] **Step 3: Schema zod + JSON**

`lib/extractor/resumen-schema.ts`:

```ts
import { z } from 'zod';

// Extracción LLM de un resumen de tarjeta o banco. Agnóstico del formato:
// cada emisor imprime distinto (BBVA consolida varias cuentas en un PDF,
// las tarjetas agrupan por titular, los consumos USD no traen pesos).

export const lineaResumenSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  descriptor: z.string(),
  /** FIRMADO en ARS: débito/consumo NEGATIVO, crédito/pago POSITIVO. null = consumo en moneda extranjera sin importe en pesos. */
  monto: z.number().nullable().default(null),
  moneda: z.enum(['ARS', 'USD', 'EUR', 'OTRA']).default('ARS'),
  /** Importe FIRMADO en la moneda origen cuando el resumen muestra ambos. */
  montoOrigen: z.number().nullable().default(null),
  cuotas: z.string().nullable().default(null),
  cuenta: z.string().nullable().default(null),
  titular: z.string().nullable().default(null),
});

export const resumenExtraccionSchema = z.object({
  tipo: z.enum(['TARJETA', 'BANCO']),
  emisor: z.string(),
  periodoAnio: z.number().int(),
  periodoMes: z.number().int().min(1).max(12),
  fechaCierre: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  totalDeclarado: z.number().nullable().default(null),
  lineas: z.array(lineaResumenSchema).default([]),
  observaciones: z.string().nullable().default(null),
});

export type ResumenExtraccion = z.infer<typeof resumenExtraccionSchema>;
export type LineaExtraida = z.infer<typeof lineaResumenSchema>;

export const resumenExtraccionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tipo: { type: 'string', enum: ['TARJETA', 'BANCO'] },
    emisor: { type: 'string', description: 'Banco/tarjeta y cuenta, ej. "Visa Business BBVA", "Santander CC $ 000-039152/2"' },
    periodoAnio: { type: 'integer' },
    periodoMes: { type: 'integer', description: '1-12, período al que corresponde el resumen' },
    fechaCierre: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    totalDeclarado: { type: ['number', 'null'], description: 'Saldo/total que imprime el resumen (firmado), para control de completitud' },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fecha: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          descriptor: { type: 'string', description: 'La descripción del movimiento TAL CUAL figura' },
          monto: { type: ['number', 'null'], description: 'Importe en PESOS, FIRMADO: débitos/consumos NEGATIVOS, créditos/pagos POSITIVOS. null si el consumo es en moneda extranjera y el resumen no muestra pesos' },
          moneda: { type: 'string', enum: ['ARS', 'USD', 'EUR', 'OTRA'] },
          montoOrigen: { type: ['number', 'null'], description: 'Importe FIRMADO en la moneda origen cuando el resumen muestra ambas columnas' },
          cuotas: { type: ['string', 'null'], description: 'ej. "3/6" si es un consumo en cuotas' },
          cuenta: { type: ['string', 'null'], description: 'A qué cuenta/tarjeta del PDF pertenece la línea (los resúmenes de banco pueden consolidar varias cuentas)' },
          titular: { type: ['string', 'null'], description: 'Titular de la tarjeta si el resumen agrupa consumos por titular' },
        },
        required: ['descriptor', 'monto', 'moneda'],
      },
    },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['tipo', 'emisor', 'periodoAnio', 'periodoMes'],
} as const;
```

- [ ] **Step 4: Extractor**

`lib/extractor/resumen.ts` (calcado de `lib/extractor/recibo.ts` — LEERLO primero y espejar su estructura):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { resumenExtraccionSchema, resumenExtraccionJsonSchema, type ResumenExtraccion } from './resumen-schema';
import type { UsoTokens } from './index';

export type ResumenExtractorInput = { texto: string | null; buffer: Buffer; mime: string };
export type ResumenExtractorResult = { extraccion: ResumenExtraccion; uso: UsoTokens | null };

export interface ResumenExtractor {
  extract(input: ResumenExtractorInput): Promise<ResumenExtractorResult>;
}

const SYSTEM_PROMPT = `Sos un extractor de RESÚMENES bancarios y de tarjeta de crédito argentinos. Cada banco/tarjeta usa un formato distinto: no asumas un layout fijo.
Reglas estrictas:
- Extraé TODAS las líneas de movimientos/consumos, incluidas comisiones, impuestos (Sircreb, imp. débito/créditos, percepciones, DB IVA), seguros y débitos automáticos.
- NO extraigas como líneas: encabezados, subtotales, saldos iniciales/finales, límites de compra ni leyendas legales.
- Los importes van FIRMADOS: débitos/consumos NEGATIVOS; créditos/pagos/rendimientos POSITIVOS.
- Consumos en moneda extranjera: si el resumen no muestra el importe en pesos, "monto" va null y "montoOrigen" lleva el importe en la moneda origen (firmado).
- Si el PDF consolida VARIAS cuentas (ej. dos cajas en pesos y una en dólares), completá "cuenta" en cada línea con la cuenta a la que pertenece.
- Si la tarjeta agrupa consumos por titular ("TOTAL CONSUMOS DE ..."), completá "titular" en cada consumo con ese nombre.
- Fechas en formato YYYY-MM-DD (inferí el año del período del resumen).
- "periodoAnio"/"periodoMes": el mes al que corresponden los movimientos (no la fecha de emisión).
- "totalDeclarado": el saldo/total del resumen si figura (firmado), para control de completitud.
- Los pagos del resumen anterior ("SU PAGO EN PESOS") SÍ van como líneas (positivas): el usuario las ignora en la conciliación.`;

class AnthropicResumenExtractor implements ResumenExtractor {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';

  async extract(input: ResumenExtractorInput): Promise<ResumenExtractorResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.texto && input.texto.trim().length > 200) {
      content.push({ type: 'text', text: `Texto extraído del PDF del resumen:\n\n${input.texto.slice(0, 100000)}` });
    } else {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') } });
    }
    content.push({ type: 'text', text: 'Extraé el resumen completo usando la herramienta.' });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384, // los resúmenes traen muchas líneas
      system: SYSTEM_PROMPT,
      tools: [{ name: 'registrar_resumen', description: 'Registra el resumen extraído', input_schema: resumenExtraccionJsonSchema as never }],
      tool_choice: { type: 'tool', name: 'registrar_resumen' },
      messages: [{ role: 'user', content }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('El modelo no devolvió la extracción estructurada');
    const u = response.usage;
    return {
      extraccion: resumenExtraccionSchema.parse(toolUse.input),
      uso: { entrada: u.input_tokens ?? 0, salida: u.output_tokens ?? 0, cacheCreacion: u.cache_creation_input_tokens ?? 0, cacheLectura: u.cache_read_input_tokens ?? 0, modelo: this.model },
    };
  }
}

/** Mock determinístico para dev/tests sin API key. */
class MockResumenExtractor implements ResumenExtractor {
  async extract(): Promise<ResumenExtractorResult> {
    return {
      extraccion: resumenExtraccionSchema.parse({
        tipo: 'TARJETA',
        emisor: 'Tarjeta Mock',
        periodoAnio: 2026,
        periodoMes: 8,
        totalDeclarado: -150000,
        lineas: [
          { fecha: '2026-08-05', descriptor: 'SERVICIO MOCK SA', monto: -100000, moneda: 'ARS', montoOrigen: null, cuotas: null, cuenta: null, titular: null },
          { fecha: '2026-08-10', descriptor: 'MOCK CLOUD USD', monto: null, moneda: 'USD', montoOrigen: -50, cuotas: null, cuenta: null, titular: null },
          { fecha: '2026-08-15', descriptor: 'COMISION MANTENIMIENTO', monto: -50000, moneda: 'ARS', montoOrigen: null, cuotas: null, cuenta: null, titular: null },
        ],
      }),
      uso: null,
    };
  }
}

export function getResumenExtractor(): ResumenExtractor {
  const mode = process.env.EXTRACTOR_MODE ?? 'mock';
  if (mode === 'real') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[resumen-extractor] EXTRACTOR_MODE=real sin ANTHROPIC_API_KEY: usando mock.');
      return new MockResumenExtractor();
    }
    return new AnthropicResumenExtractor();
  }
  return new MockResumenExtractor();
}
```

- [ ] **Step 5: GREEN + verificación** — `npx vitest run tests/resumen-schema.test.ts && npx tsc --noEmit` PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/extractor/resumen-schema.ts lib/extractor/resumen.ts tests/resumen-schema.test.ts
git commit -m "feat(resumenes): extractor LLM de resúmenes de tarjeta y banco"
```

---

### Task 3: Motor de matching línea ↔ movimiento (puro)

**Files:**
- Create: `lib/resumenes/matching.ts`
- Test: `tests/resumen-matching.test.ts`

**Interfaces:**
- Produces:
  - `normalizarDescriptor(s: string): string` (minúsculas, sin acentos/símbolos, espacios colapsados)
  - `similitudTexto(a: string, b: string): number` (0..1, Dice sobre bigramas)
  - `type MovimientoCandidato = { id: string; total: number | null; moneda: string; fecha: Date | null; nombreContraparte: string | null; descriptores: string[] }`
  - `type LineaParaMatching = { fecha: Date | null; descriptor: string; monto: number | null; montoOrigen: number | null; moneda: string }`
  - `evaluarLinea(linea: LineaParaMatching, candidatos: MovimientoCandidato[]): { estado: 'SUGERIDA' | 'PENDIENTE'; candidatos: { movimientoId: string; score: number; motivo: string }[] }`

- [ ] **Step 1: Tests (RED)**

`tests/resumen-matching.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizarDescriptor, similitudTexto, evaluarLinea, type MovimientoCandidato } from '@/lib/resumenes/matching';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const anthropic: MovimientoCandidato = {
  id: 'mov-anthropic', total: 100, moneda: 'USD', fecha: d('2026-06-28'),
  nombreContraparte: 'Anthropic, PBC', descriptores: [],
};
const edesur: MovimientoCandidato = {
  id: 'mov-edesur', total: 259381.13, moneda: 'ARS', fecha: d('2026-07-09'),
  nombreContraparte: 'Edesur', descriptores: [],
};

describe('normalizarDescriptor y similitud', () => {
  it('normaliza mayúsculas, símbolos y espacios', () => {
    expect(normalizarDescriptor('ANTHROPIC* CLAUD  in1TnfMiB')).toBe('anthropic claud in1tnfmib');
  });
  it('similitud alta entre descriptor y contraparte', () => {
    expect(similitudTexto('anthropic claud', 'anthropic pbc')).toBeGreaterThan(0.4);
    expect(similitudTexto('starlink', 'edesur')).toBeLessThan(0.2);
  });
});

describe('evaluarLinea', () => {
  it('caso Anthropic: monto USD + fecha cercana + texto → SUGERIDA', () => {
    const r = evaluarLinea(
      { fecha: d('2026-06-29'), descriptor: 'ANTHROPIC* CLAUD', monto: null, montoOrigen: -100, moneda: 'USD' },
      [anthropic, edesur],
    );
    expect(r.estado).toBe('SUGERIDA');
    expect(r.candidatos[0].movimientoId).toBe('mov-anthropic');
  });

  it('monto exacto ARS + fecha cercana → SUGERIDA aun sin texto', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-10'), descriptor: 'DEB AUT LUZ 999', monto: -259381.13, montoOrigen: null, moneda: 'ARS' },
      [edesur],
    );
    expect(r.estado).toBe('SUGERIDA');
  });

  it('sólo coincide el texto → PENDIENTE con candidatos', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-20'), descriptor: 'EDESUR CUOTA PLAN', monto: -50000, montoOrigen: null, moneda: 'ARS' },
      [edesur],
    );
    expect(r.estado).toBe('PENDIENTE');
    expect(r.candidatos.length).toBeGreaterThan(0);
  });

  it('sin señales → PENDIENTE sin candidatos', () => {
    const r = evaluarLinea(
      { fecha: d('2026-07-01'), descriptor: 'SIRCREB RECAUDACION', monto: -2210576.35, montoOrigen: null, moneda: 'ARS' },
      [anthropic, edesur],
    );
    expect(r.candidatos).toHaveLength(0);
  });

  it('descriptor aprendido matchea con confianza alta', () => {
    const conAprendido = { ...edesur, total: 111, descriptores: ['edesur cuota plan'] };
    const r = evaluarLinea(
      { fecha: d('2026-07-20'), descriptor: 'EDESUR CUOTA PLAN', monto: -111, montoOrigen: null, moneda: 'ARS' },
      [conAprendido],
    );
    expect(r.estado).toBe('SUGERIDA');
  });
});
```

- [ ] **Step 2: RED** — módulo inexistente.

- [ ] **Step 3: Implementación**

`lib/resumenes/matching.ts`:

```ts
// Matching PURO línea de resumen ↔ movimiento existente (anti-duplicados).
// Señales: monto (fuerte: exacto ±$1, en ARS o en moneda origen), fecha
// (±45 días, decae linealmente) y texto (Dice sobre bigramas del descriptor
// vs contraparte + descriptores aprendidos). SUGERIDA = monto + (fecha>0.5 o
// texto>0.4); una sola señal = candidato; nada = sin candidatos.

export type MovimientoCandidato = {
  id: string;
  total: number | null;
  moneda: string;
  fecha: Date | null;
  nombreContraparte: string | null;
  descriptores: string[]; // aprendidos, ya normalizados
};

export type LineaParaMatching = {
  fecha: Date | null;
  descriptor: string;
  monto: number | null; // ARS firmado
  montoOrigen: number | null; // moneda origen firmado
  moneda: string;
};

export function normalizarDescriptor(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramas(s: string): Set<string> {
  const t = s.replace(/ /g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre bigramas (0..1). */
export function similitudTexto(a: string, b: string): number {
  const A = bigramas(normalizarDescriptor(a));
  const B = bigramas(normalizarDescriptor(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const DIAS_VENTANA = 45;
const TOL_CENTAVOS = 100;

function señalMonto(linea: LineaParaMatching, mov: MovimientoCandidato): boolean {
  if (mov.total == null) return false;
  const totalCent = Math.round(Math.abs(mov.total) * 100);
  if (linea.monto != null && Math.abs(Math.round(Math.abs(linea.monto) * 100) - totalCent) <= TOL_CENTAVOS) return true;
  // Consumo en moneda extranjera vs comprobante en esa moneda
  if (
    linea.montoOrigen != null &&
    linea.moneda !== 'ARS' &&
    mov.moneda === linea.moneda &&
    Math.abs(Math.round(Math.abs(linea.montoOrigen) * 100) - totalCent) <= TOL_CENTAVOS
  ) {
    return true;
  }
  return false;
}

function señalFecha(linea: LineaParaMatching, mov: MovimientoCandidato): number {
  if (!linea.fecha || !mov.fecha) return 0;
  const dias = Math.abs(linea.fecha.getTime() - mov.fecha.getTime()) / 86400000;
  if (dias > DIAS_VENTANA) return 0;
  return 1 - dias / DIAS_VENTANA;
}

function señalTexto(linea: LineaParaMatching, mov: MovimientoCandidato): number {
  const desc = normalizarDescriptor(linea.descriptor);
  let mejor = mov.nombreContraparte ? similitudTexto(desc, mov.nombreContraparte) : 0;
  for (const aprendido of mov.descriptores) {
    mejor = Math.max(mejor, similitudTexto(desc, aprendido));
  }
  return mejor;
}

export function evaluarLinea(
  linea: LineaParaMatching,
  candidatos: MovimientoCandidato[],
): { estado: 'SUGERIDA' | 'PENDIENTE'; candidatos: { movimientoId: string; score: number; motivo: string }[] } {
  const puntuados = candidatos
    .map((mov) => {
      const monto = señalMonto(linea, mov);
      const fecha = señalFecha(linea, mov);
      const texto = señalTexto(linea, mov);
      const motivos: string[] = [];
      if (monto) motivos.push('monto exacto');
      if (fecha > 0.5) motivos.push('fecha cercana');
      if (texto > 0.4) motivos.push('texto similar');
      // Score: monto pesa 0.6; fecha y texto completan.
      const score = (monto ? 0.6 : 0) + fecha * 0.15 + texto * 0.25;
      return { movimientoId: mov.id, score: Math.round(score * 100) / 100, motivo: motivos.join(' + ') || 'coincidencia débil', señales: { monto, fecha, texto } };
    })
    .filter((c) => c.señales.monto || c.señales.texto > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = puntuados[0];
  const sugerida = top != null && top.señales.monto && (top.señales.fecha > 0.5 || top.señales.texto > 0.4);
  return {
    estado: sugerida ? 'SUGERIDA' : 'PENDIENTE',
    candidatos: puntuados.map(({ movimientoId, score, motivo }) => ({ movimientoId, score, motivo })),
  };
}
```

- [ ] **Step 4: GREEN** — `npx vitest run tests/resumen-matching.test.ts` PASS (ajustar umbrales SOLO si un test del brief falla por décimas, documentándolo en el reporte).

- [ ] **Step 5: Commit**

```bash
git add lib/resumenes/matching.ts tests/resumen-matching.test.ts
git commit -m "feat(resumenes): motor de matching línea-movimiento por monto, fecha y texto"
```

---

### Task 4: Ingesta de resúmenes + worker

**Files:**
- Create: `lib/resumenes/ingesta.ts`
- Modify: `lib/jobs.ts` (`TipoJob` += `'EXTRACCION_RESUMEN'`)
- Modify: `worker.ts` (case nuevo)

**Interfaces:**
- Consumes: `getFileStorage`, `enqueueJob`, `writeAudit`, `getOrCreatePeriodo`, `scopedDb`, `DomainError`, `getResumenExtractor` (Task 2), `evaluarLinea`/`normalizarDescriptor` (Task 3), `nombreContraparte` de `lib/movimientos/nombre-contraparte` para armar candidatos.
- Produces:
  - `ingestarResumen(params: { empresaId: string; usuarioId: string; buffer: Buffer; filename: string; mime: string; tipo: 'TARJETA' | 'BANCO'; emisor: string }): Promise<{ resumenId: string }>`
  - `procesarExtraccionResumen(payload: { resumenId: string; empresaId: string }): Promise<void>`
  - `rematchearResumen(db: ScopedDb, resumenId: string): Promise<void>` (recalcula matching de líneas PENDIENTE/SUGERIDA)

- [ ] **Step 1: Implementar ingesta**

`lib/resumenes/ingesta.ts` (sin test unitario con DB propio: la lógica decidible ya está pura en Task 3; la integración se cubre en Task 5 y el e2e en Task 8):

```ts
import { prisma } from '@/lib/db';
import { scopedDb, type ScopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { enqueueJob } from '@/lib/jobs';
import { writeAudit } from '@/lib/audit';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { DomainError } from '@/lib/errors';
import { getResumenExtractor } from '@/lib/extractor/resumen';
import { evaluarLinea, normalizarDescriptor, type MovimientoCandidato } from './matching';

// Pipeline de resúmenes: PDF -> Resumen PROCESANDO -> Job EXTRACCION_RESUMEN
// -> worker extrae líneas -> matching automático -> EXTRAIDO. El período se
// crea al extraer (el que declara el propio resumen).

export async function ingestarResumen(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
  tipo: 'TARJETA' | 'BANCO';
  emisor: string;
}): Promise<{ resumenId: string }> {
  if (params.mime !== 'application/pdf') throw new DomainError('Los resúmenes se cargan como PDF.');
  if (!params.emisor.trim()) throw new DomainError('Indicá el banco/tarjeta emisor.');
  const db = scopedDb(params.empresaId);
  const storage = getFileStorage();
  const { key, hash } = await storage.put(params.buffer, { filename: params.filename, mime: params.mime, empresaId: params.empresaId });

  // Mismo archivo ya subido (hash): se rechaza — un resumen no se re-sube.
  const existente = await db.resumen.findFirst({ where: { archivoHash: hash }, select: { id: true, emisor: true } });
  if (existente) throw new DomainError(`Ese archivo ya fue subido (resumen de ${existente.emisor}).`);

  // El período definitivo lo declara el resumen; hasta extraer se ancla al mes actual.
  const periodo = await getOrCreatePeriodo(db, new Date());
  const resumen = await db.resumen.create({
    data: {
      tipo: params.tipo,
      emisor: params.emisor.trim(),
      periodoId: periodo.id,
      archivoKey: key,
      archivoNombre: params.filename,
      archivoMime: params.mime,
      archivoHash: hash,
    } as never,
  });
  await writeAudit(db, {
    usuarioId: params.usuarioId,
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'CREAR',
    despues: { tipo: params.tipo, emisor: params.emisor, archivo: params.filename, hash },
  });
  await enqueueJob('EXTRACCION_RESUMEN', { resumenId: resumen.id, empresaId: params.empresaId }, params.empresaId);
  return { resumenId: resumen.id };
}

/** Candidatos de matching para una fecha dada (ventana ±45 días). */
async function candidatosDeMatching(db: ScopedDb, empresaId: string): Promise<MovimientoCandidato[]> {
  const movs = await db.movimiento.findMany({
    where: { estado: { notIn: ['ANULADO', 'DUPLICADO'] } },
    include: { contraparte: true, lineasResumen: { where: { estado: 'CONCILIADA' }, select: { id: true } } },
  });
  return movs
    .filter((m) => m.lineasResumen.length === 0) // un movimiento admite una sola línea conciliada
    .map((m) => ({
      id: m.id,
      total: m.total != null ? Number(m.total) : null,
      moneda: m.moneda,
      fecha: m.fechaDevengamiento ?? m.createdAt,
      nombreContraparte: m.contraparte?.razonSocial ?? (m.extraccionRaw as { razonSocialEmisor?: string } | null)?.razonSocialEmisor ?? null,
      descriptores: ((m.contraparte?.descriptoresResumen as string[] | null) ?? []).map(normalizarDescriptor),
    }));
}

export async function procesarExtraccionResumen(payload: { resumenId: string; empresaId: string }): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const resumen = await db.resumen.findFirst({ where: { id: payload.resumenId } });
  if (!resumen) throw new Error(`Resumen ${payload.resumenId} inexistente`);

  const buffer = await getFileStorage().get(resumen.archivoKey);
  const { extractText, getDocumentProxy } = await import('unpdf');
  let texto: string | null = null;
  try {
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const r = await extractText(doc, { mergePages: true });
    texto = r.text as string;
  } catch {
    texto = null;
  }

  const { extraccion, uso } = await getResumenExtractor().extract({ texto, buffer, mime: resumen.archivoMime });

  const periodo = await getOrCreatePeriodo(db, new Date(Date.UTC(extraccion.periodoAnio, extraccion.periodoMes - 1, 1)));
  const candidatos = await candidatosDeMatching(db, payload.empresaId);

  // Reemplaza líneas previas (reintento de extracción): sólo las no resueltas.
  await prisma.resumenLinea.deleteMany({ where: { resumenId: resumen.id, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });

  let orden = 0;
  for (const linea of extraccion.lineas) {
    const fecha = linea.fecha ? new Date(`${linea.fecha}T00:00:00Z`) : null;
    const evaluacion = evaluarLinea(
      { fecha, descriptor: linea.descriptor, monto: linea.monto, montoOrigen: linea.montoOrigen, moneda: linea.moneda },
      candidatos,
    );
    await prisma.resumenLinea.create({
      data: {
        resumenId: resumen.id,
        orden: orden++,
        fecha,
        descriptor: linea.descriptor,
        monto: linea.monto,
        moneda: linea.moneda as never,
        montoOrigen: linea.montoOrigen,
        cuotas: linea.cuotas,
        cuenta: linea.cuenta,
        titular: linea.titular,
        estado: evaluacion.estado as never,
        candidatos: evaluacion.candidatos as never,
      },
    });
  }

  await db.resumen.update({
    where: { id: resumen.id },
    data: {
      estado: 'EXTRAIDO',
      periodoId: periodo.id,
      tipo: extraccion.tipo as never,
      fechaCierre: extraccion.fechaCierre ? new Date(`${extraccion.fechaCierre}T00:00:00Z`) : null,
      totalDeclarado: extraccion.totalDeclarado,
      extraccionRaw: extraccion as never,
      tokensEntrada: uso?.entrada ?? null,
      tokensSalida: uso?.salida ?? null,
      tokensCacheCreacion: uso?.cacheCreacion ?? null,
      tokensCacheLectura: uso?.cacheLectura ?? null,
      modeloExtractor: uso?.modelo ?? null,
    },
  });
  await writeAudit(db, {
    entidad: 'Resumen',
    entidadId: resumen.id,
    accion: 'EXTRAER',
    despues: { lineas: extraccion.lineas.length, periodo: `${extraccion.periodoAnio}-${extraccion.periodoMes}`, totalDeclarado: extraccion.totalDeclarado },
  });
}

/** Recalcula el matching de las líneas no resueltas (botón "Re-matchear"). */
export async function rematchearResumen(db: ScopedDb, empresaId: string, resumenId: string): Promise<void> {
  const lineas = await db.resumenLinea.findMany({ where: { resumenId, estado: { in: ['PENDIENTE', 'SUGERIDA'] } } });
  const candidatos = await candidatosDeMatching(db, empresaId);
  for (const l of lineas) {
    const evaluacion = evaluarLinea(
      { fecha: l.fecha, descriptor: l.descriptor, monto: l.monto != null ? Number(l.monto) : null, montoOrigen: l.montoOrigen != null ? Number(l.montoOrigen) : null, moneda: l.moneda },
      candidatos,
    );
    await db.resumenLinea.update({
      where: { id: l.id },
      data: { estado: evaluacion.estado as never, candidatos: evaluacion.candidatos as never },
    });
  }
}
```

- [ ] **Step 2: Registrar job y worker**

`lib/jobs.ts`: `TipoJob` += `'EXTRACCION_RESUMEN'`.
`worker.ts`: importar `procesarExtraccionResumen` de `@/lib/resumenes/ingesta` y agregar el case `'EXTRACCION_RESUMEN'` después de `'EXTRACCION_RECIBO'`.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit && npm test` (suite completa verde).

- [ ] **Step 4: Commit**

```bash
git add lib/resumenes/ingesta.ts lib/jobs.ts worker.ts
git commit -m "feat(resumenes): pipeline de ingesta con matching automático vía worker"
```

---

### Task 5: Servicio de conciliación (conciliar / imputar / ignorar / deshacer)

**Files:**
- Create: `lib/resumenes/service.ts`
- Test: `tests/resumen-conciliacion.test.ts` (integración contra la base)

**Interfaces:**
- Consumes: `EmpresaContext`, `DomainError`, `writeAudit`, `validarDistribucion`/`LineaDistribucion`, `validarPertenenciaLineas` (lib/movimientos/service), `getOrCreatePeriodo`, `normalizarDescriptor` (Task 3), `esEstadoInicialValido`.
- Produces (todas con `ctx: EmpresaContext`):
  - `conciliarLinea(ctx, { lineaId, movimientoId }): Promise<void>`
  - `imputarLinea(ctx, { lineaId, categoriaId, lineas: LineaDistribucion[], contraparteId?, montoArs? }): Promise<void>`
  - `ignorarLinea(ctx, { lineaId, motivo }): Promise<void>`
  - `deshacerLinea(ctx, { lineaId }): Promise<void>`

- [ ] **Step 1: Test de integración (RED)** — patrón de `tests/reasignar-recibo.test.ts` (empresa+datos propios con sufijo, afterAll limpia):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { conciliarLinea, imputarLinea, ignorarLinea, deshacerLinea } from '@/lib/resumenes/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Conciliación de líneas: conciliar NO crea gasto (anti-duplicados), imputar
// crea un Movimiento origen RESUMEN que nace ASIGNADO, ignorar aparta con
// motivo, y todo se puede deshacer.

describe('conciliación de líneas de resumen (integración)', () => {
  const sufijo = `conc-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let resumenId: string;
  let movExistente: string;
  let categoriaId: string;
  let centroId: string;
  const linea = async (datos: Record<string, unknown> = {}) =>
    prisma.resumenLinea.create({
      data: { resumenId, orden: 99, descriptor: 'LINEA TEST', monto: -1000, moneda: 'ARS', fecha: new Date('2031-05-10T00:00:00Z'), ...datos } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Conc', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Conc SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    const periodo = await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 5 } });
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Gastos Test', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Centro Test', tipo: 'SOPORTE' } })).id;
    resumenId = (await prisma.resumen.create({
      data: { empresaId, tipo: 'TARJETA', emisor: 'Test', periodoId: periodo.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}` },
    })).id;
    movExistente = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 1000, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-09T00:00:00Z'), periodoId: periodo.id },
    })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('conciliar vincula sin crear movimiento (anti-duplicados)', async () => {
    const l = await linea();
    const antes = await prisma.movimiento.count({ where: { empresaId } });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movExistente });
    expect(await prisma.movimiento.count({ where: { empresaId } })).toBe(antes);
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('CONCILIADA');
    expect(actual!.movimientoId).toBe(movExistente);
  });

  it('un movimiento admite UNA sola línea conciliada', async () => {
    const l2 = await linea();
    await expect(conciliarLinea(ctx, { lineaId: l2.id, movimientoId: movExistente })).rejects.toThrow(DomainError);
  });

  it('imputar crea un movimiento ASIGNADO origen RESUMEN', async () => {
    const l = await linea({ descriptor: 'SIRCREB', monto: -2210576.35 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id }, include: { movimiento: true } });
    expect(actual!.estado).toBe('IMPUTADA');
    expect(actual!.movimiento!.origen).toBe('RESUMEN');
    expect(actual!.movimiento!.estado).toBe('ASIGNADO');
    expect(Number(actual!.movimiento!.total)).toBeCloseTo(2210576.35, 2);
    expect(actual!.movimiento!.moneda).toBe('ARS');
  });

  it('imputar una línea USD sin pesos exige montoArs', async () => {
    const l = await linea({ monto: null, moneda: 'USD', montoOrigen: -50 });
    await expect(imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] })).rejects.toThrow(/pesos/);
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }], montoArs: 76000 });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id }, include: { movimiento: true } });
    expect(Number(actual!.movimiento!.total)).toBe(76000);
  });

  it('ignorar y deshacer', async () => {
    const l = await linea();
    await ignorarLinea(ctx, { lineaId: l.id, motivo: 'pago del resumen anterior' });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('IGNORADA');
    await deshacerLinea(ctx, { lineaId: l.id });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });

  it('deshacer una imputación anula el movimiento creado', async () => {
    const l = await linea({ descriptor: 'COMISION', monto: -500 });
    await imputarLinea(ctx, { lineaId: l.id, categoriaId, lineas: [{ centroCostoId: centroId, porcentaje: 100 }] });
    const movId = (await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.movimientoId!;
    await deshacerLinea(ctx, { lineaId: l.id });
    expect((await prisma.movimiento.findUnique({ where: { id: movId } }))!.estado).toBe('ANULADO');
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });
});
```

- [ ] **Step 2: RED**, **Step 3: Implementación**

`lib/resumenes/service.ts`:

```ts
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { validarDistribucion, type LineaDistribucion } from '@/lib/movimientos/distribucion';
import { validarPertenenciaLineas } from '@/lib/movimientos/service';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { normalizarDescriptor } from './matching';

// Acciones sobre líneas de resumen. Conciliar NO crea gasto (el movimiento ya
// está en el libro): acá muere el doble conteo. Imputar crea el gasto tomando
// la línea como base (origen RESUMEN, nace ASIGNADO). Todo auditado.

async function lineaOrThrow(ctx: EmpresaContext, lineaId: string) {
  const linea = await ctx.db.resumenLinea.findFirst({ where: { id: lineaId }, include: { resumen: true } });
  if (!linea) throw new DomainError('Línea de resumen inexistente.');
  return linea;
}

async function aprenderDescriptor(ctx: EmpresaContext, contraparteId: string | null, descriptor: string): Promise<void> {
  if (!contraparteId) return;
  const contraparte = await ctx.db.contraparte.findFirst({ where: { id: contraparteId } });
  if (!contraparte) return;
  const lista = ((contraparte.descriptoresResumen as string[] | null) ?? []);
  const norm = normalizarDescriptor(descriptor);
  if (!norm || lista.includes(norm)) return;
  await ctx.db.contraparte.update({
    where: { id: contraparte.id },
    data: { descriptoresResumen: [...lista, norm].slice(-10) as never },
  });
}

export async function conciliarLinea(ctx: EmpresaContext, params: { lineaId: string; movimientoId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'CONCILIADA' || linea.estado === 'IMPUTADA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.estado === 'ANULADO' || mov.estado === 'DUPLICADO') throw new DomainError('Ese movimiento está anulado o duplicado.');
  const yaConciliado = await ctx.db.resumenLinea.findFirst({
    where: { movimientoId: mov.id, estado: 'CONCILIADA', id: { not: linea.id } },
  });
  if (yaConciliado) throw new DomainError('Ese movimiento ya está conciliado con otra línea.');

  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'CONCILIADA', movimientoId: mov.id } });
  await aprenderDescriptor(ctx, mov.contraparteId, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_CONCILIAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: mov.id },
  });
}

export async function imputarLinea(
  ctx: EmpresaContext,
  params: { lineaId: string; categoriaId: string; lineas: LineaDistribucion[]; contraparteId?: string | null; montoArs?: number | null },
): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'CONCILIADA' || linea.estado === 'IMPUTADA') throw new DomainError('La línea ya está resuelta: deshacela primero.');

  const montoBase = linea.monto != null ? Math.abs(Number(linea.monto)) : params.montoArs != null && params.montoArs > 0 ? params.montoArs : null;
  if (montoBase == null) throw new DomainError('La línea no tiene importe en pesos: ingresá el monto final en pesos para imputarla.');

  const categoria = await ctx.db.categoria.findFirst({ where: { id: params.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');
  validarDistribucion(params.lineas);
  await validarPertenenciaLineas(ctx.db, params.lineas);
  if (params.contraparteId) {
    const cp = await ctx.db.contraparte.findFirst({ where: { id: params.contraparteId } });
    if (!cp) throw new DomainError('Contraparte inexistente.');
  }

  const fecha = linea.fecha ?? new Date();
  const periodo = await getOrCreatePeriodo(ctx.db, fecha);
  if (periodo.estado === 'CERRADO') throw new DomainError('El período de la línea está cerrado: reabrilo para imputar.');

  // El signo lo define la categoría (INGRESO/EGRESO), como en todo el libro.
  const mov = await ctx.db.movimiento.create({
    data: {
      origen: 'RESUMEN',
      estado: 'ASIGNADO',
      fechaDevengamiento: fecha,
      periodoId: periodo.id,
      categoriaId: categoria.id,
      contraparteId: params.contraparteId ?? null,
      descripcion: linea.descriptor,
      moneda: 'ARS', // la tarjeta/cuenta debitó pesos
      total: montoBase,
      canalIngreso: 'MANUAL',
      creadoPorId: ctx.usuario.id,
      validadoPorId: ctx.usuario.id,
    } as never,
  });
  await prisma.movimientoLinea.createMany({
    data: params.lineas.map((l) => ({
      movimientoId: mov.id,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IMPUTADA', movimientoId: mov.id } });
  await aprenderDescriptor(ctx, params.contraparteId ?? null, linea.descriptor);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IMPUTAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, movimientoId: mov.id, total: montoBase, categoria: categoria.nombre },
  });
}

export async function ignorarLinea(ctx: EmpresaContext, params: { lineaId: string; motivo: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'CONCILIADA' || linea.estado === 'IMPUTADA') throw new DomainError('La línea ya está resuelta: deshacela primero.');
  if (!params.motivo.trim()) throw new DomainError('Indicá el motivo para ignorar la línea.');
  await ctx.db.resumenLinea.update({ where: { id: linea.id }, data: { estado: 'IGNORADA', motivoIgnorada: params.motivo.trim() } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_IGNORAR',
    despues: { lineaId: linea.id, descriptor: linea.descriptor, motivo: params.motivo },
  });
}

export async function deshacerLinea(ctx: EmpresaContext, params: { lineaId: string }): Promise<void> {
  const linea = await lineaOrThrow(ctx, params.lineaId);
  if (linea.estado === 'PENDIENTE') return;
  // Imputación deshecha: el movimiento creado desde la línea se anula.
  if (linea.estado === 'IMPUTADA' && linea.movimientoId) {
    const mov = await ctx.db.movimiento.findFirst({ where: { id: linea.movimientoId }, include: { periodo: true } });
    if (mov) {
      if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento imputado está cerrado.');
      await ctx.db.movimiento.update({
        where: { id: mov.id },
        data: { estado: 'ANULADO', motivoAnulacion: 'Imputación de resumen deshecha' },
      });
    }
  }
  await ctx.db.resumenLinea.update({
    where: { id: linea.id },
    data: { estado: 'PENDIENTE', movimientoId: null, motivoIgnorada: null },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Resumen',
    entidadId: linea.resumenId,
    accion: 'RESUMEN_DESHACER',
    antes: { lineaId: linea.id, estado: linea.estado, movimientoId: linea.movimientoId },
  });
}
```

Nota: `Movimiento.motivoAnulacion` y la transición `ASIGNADO → ANULADO` ya existen. `esEstadoInicialValido('RESUMEN','ASIGNADO')` es true desde Task 1 (el create directo no pasa por `assertTransicion`, pero el estado inicial queda documentado y testeado).

- [ ] **Step 4: GREEN** — `npx vitest run tests/resumen-conciliacion.test.ts && npx tsc --noEmit && npm test` todo verde.

- [ ] **Step 5: Commit**

```bash
git add lib/resumenes/service.ts tests/resumen-conciliacion.test.ts
git commit -m "feat(resumenes): servicio de conciliación con imputación directa y deshacer"
```

---

### Task 6: UI — lista de resúmenes, subida y sidebar

**Files:**
- Create: `app/(app)/[empresaSlug]/resumenes/actions.ts`
- Create: `app/(app)/[empresaSlug]/resumenes/page.tsx`
- Create: `components/resumenes-upload.tsx`
- Modify: `app/(app)/[empresaSlug]/layout.tsx` (Registros → Resúmenes)

**Interfaces:**
- Consumes: `ingestarResumen`/`rematchearResumen` (Task 4), servicio (Task 5), `requireEmpresa(slug,'VALIDADOR')`, `parsearImporteAr` (lib/format), `MES_LABEL` (lib/periodos), `formatMoney`.
- Produces: actions `subirResumenAction` (devuelve `{ ok, resumenId?, error? }`), `conciliarAction`, `imputarAction`, `ignorarAction`, `deshacerAction`, `rematchearAction` — contrato de FormData para Task 7: hidden `empresaSlug`, `resumenId`, `lineaId`; imputar usa `categoriaId`, inputs `linea_*` del DistribucionEditor, `contraparteId`, `montoArs`; ignorar usa `motivo`; conciliar usa `movimientoId`.

- [ ] **Step 1: Actions** — calcar el patrón de `app/(app)/[empresaSlug]/empleados/actions.ts` (leerlo): guard `requireEmpresa(slug, 'VALIDADOR')` en TODAS, `volverConError` redirigiendo a `resumenes/${resumenId}`, `leerLineas` idéntico, subida con MAX 15MB y sólo PDF más campos `tipo` (TARJETA|BANCO) y `emisor`. `subirResumenAction` retorna `{ ok, resumenId, error }` para el componente.

- [ ] **Step 2: Componente de subida** — `components/resumenes-upload.tsx` calcado de `components/recibos-upload.tsx` (leerlo), agregando select de tipo (Tarjeta/Banco) e input de emisor antes del botón de archivo.

- [ ] **Step 3: Página lista** — `app/(app)/[empresaSlug]/resumenes/page.tsx`:
  - `requireEmpresaPage(slug, 'VALIDADOR')`.
  - Query: `ctx.db.resumen.findMany({ include: { periodo: true, lineas: { select: { estado: true, monto: true } } }, orderBy: { createdAt: 'desc' }, take: 50 })` + jobs `EXTRACCION_RESUMEN` failed/en cola (patrón de la página de empleados con `prisma.job`).
  - Tabla: emisor, tipo (badge Tarjeta/Banco), período (`MES_LABEL[p.mes] p.anio`), total declarado, **progreso**: `resueltas/total` líneas (resueltas = estado != PENDIENTE && != SUGERIDA) con mini barra (`<div>` de ancho %), estado extracción (PROCESANDO con AutoRefresh activo — reusar `components/auto-refresh.tsx`), link "Abrir".
  - Header con `<ResumenesUpload>`.

- [ ] **Step 4: Sidebar** — en `app/(app)/[empresaSlug]/layout.tsx`, sección Registros (visible para todos; la page igual exige VALIDADOR), después de "Asientos manuales":

```ts
        { href: `${base}/resumenes`, label: 'Resúmenes', icono: 'comprobante' },
```

(verificar en `components/iconos.tsx` que `comprobante` existe; si hay uno más adecuado tipo `periodo`, elegirlo y decirlo en el reporte).

- [ ] **Step 5: Verificar** — `npx tsc --noEmit && npm run build && npm test` limpios.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/\[empresaSlug\]/resumenes/ components/resumenes-upload.tsx app/\(app\)/\[empresaSlug\]/layout.tsx
git commit -m "feat(resumenes): sección Resúmenes con subida y lista con progreso"
```

---

### Task 7: UI — bandeja de conciliación

**Files:**
- Create: `app/(app)/[empresaSlug]/resumenes/[id]/page.tsx`

**Interfaces:**
- Consumes: actions de Task 6 (`conciliarAction`, `imputarAction`, `ignorarAction`, `deshacerAction`, `rematchearAction` desde `../actions`), `DistribucionEditor` (prop `inicial`, singular — verificar en el código), `DocViewer`, `formatMoney`, `formatFecha`.

- [ ] **Step 1: Página bandeja** — server component, panel por querystring (patrón de `empleados/prepagas/page.tsx` — leerlo):
  - `requireEmpresaPage(slug, 'VALIDADOR')`; 404 si el resumen no existe.
  - Query del resumen con `lineas` (orderBy orden) incluyendo `movimiento: { include: { contraparte: true } }`; catálogos (categorías activas, centros/clientes/proyectos activos, contrapartes activas) para el form de imputación.
  - **Header**: emisor + tipo + período + fechaCierre + link al PDF (`/api/archivos/${archivoKey}` con DocViewer colapsable o link simple), botón "Re-matchear" (form → `rematchearAction`), **barra de progreso** (resueltas/total) y **control de completitud**: si `totalDeclarado != null`, comparar con la suma de `monto` de las líneas; si difiere en más de $1, banner ámbar con la diferencia.
  - **Acción masiva**: form "Confirmar todas las sugeridas" → `conciliarAction` es por línea; para la masiva agregar action `confirmarSugeridasAction` en `../actions` que itera las líneas SUGERIDA del resumen llamando `conciliarLinea` con su primer candidato (score top) y reporta cuántas confirmó.
  - **Lista de líneas**: una fila por línea: fecha, descriptor (+ cuenta/titular en subtexto gris), cuotas, monto (rojo negativo / verde positivo; si `monto` null mostrar `USD {montoOrigen}`), chip de estado con color: PENDIENTE blanco/borde, SUGERIDA ámbar (mostrar el candidato top: nombre del movimiento + score + botón "Conciliar" inline), CONCILIADA verde (link al movimiento + "deshacer"), IMPUTADA azul (link + "deshacer"), IGNORADA gris (motivo + "deshacer"). Cada fila linkea a `?linea={id}` para abrir el panel.
  - **Panel de línea** (querystring `?linea=`): datos completos de la línea; candidatos rankeados (resolver los ids de `candidatos` Json contra los movimientos para mostrar nombre/total/fecha + motivo + botón Conciliar cada uno); buscador manual (select de movimientos recientes no conciliados, take 100, con label contraparte+fecha+total → Conciliar); form de **imputación**: categoría (select), `DistribucionEditor`, contraparte opcional (select), input `montoArs` visible sólo si `linea.monto == null` (con hint del TC implícito si hay `montoOrigen`), botón Imputar; form Ignorar con motivo.
- [ ] **Step 2: Vínculo en el detalle del movimiento** — en `app/(app)/[empresaSlug]/validacion/[id]/page.tsx`, junto a los banners: si el movimiento tiene `lineasResumen` (include en la query) con estado CONCILIADA o IMPUTADA, mostrar línea informativa: «Conciliado con la línea "{descriptor}" del resumen {emisor} ({MES_LABEL[mes]} {anio})» con link a la bandeja.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit && npm run build && npm test`.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/\[empresaSlug\]/resumenes/ app/\(app\)/\[empresaSlug\]/validacion/\[id\]/page.tsx
git commit -m "feat(resumenes): bandeja de conciliación con candidatos, imputación e ignorar"
```

---

### Task 8: E2E en dev con los resúmenes reales + verificación final

**Files:** (sin código nuevo salvo fixes que surjan)

- [ ] **Step 1: Verificación local completa** — `npm test && npx tsc --noEmit && npm run build` todo verde.

- [ ] **Step 2: Deploy a dev** — rsync con `--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r` y excludes anclados (incluye `/Docs/`), `npx prisma db push`, build, restart `pnl-web pnl-worker`. Copiar los 6 PDFs de `Docs/Resumenes Ejemplo/` al server (fuera de rsync, path con espacio: usar comillas).

- [ ] **Step 3: E2E** — como admin en ewwo, subir los 6 resúmenes reales (2 tarjetas, 3 cuentas, Mercado Pago) y verificar:
  - Los 6 extraen (estado EXTRAIDO); el Santander U$S da 0 líneas sin error.
  - La Visa Santander sugiere conciliar los 2 consumos ANTHROPIC* CLAUD (USD 100) contra los 2 movimientos de Anthropic existentes.
  - El BBVA cuenta trae líneas con `cuenta` diferenciada; la Visa Business trae `titular` por consumo y las líneas de impuestos (DB IVA, comisión, percepciones).
  - Imputar una línea (ej. Sircreb → Impuestos / Administración) crea el movimiento ASIGNADO visible en el libro y en el P&L de julio; deshacerla lo anula.
  - Conciliar no altera los totales del libro (comparar resumen de Movimientos antes/después).
  - Un CARGADOR no accede a `/resumenes` (403).

- [ ] **Step 4: Push final** — commits pusheados a master.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec:** modelos/scope/origen → Task 1; extractor con casos reales → Task 2; matching con las tres señales, umbrales y aprendizaje → Tasks 3 y 5 (aprenderDescriptor); ingesta+hash+worker+re-matcheo → Task 4; acciones conciliar/imputar/ignorar/deshacer con guardas y auditoría → Task 5; lista+upload+sidebar → Task 6; bandeja visual con candidatos, masiva, completitud y vínculo en el detalle del movimiento → Task 7; e2e con los 6 PDFs → Task 8. Fuera de alcance respetado (sin CSV/OFX, sin matching entre resúmenes, sin reglas por descriptor).
- **Tipos consistentes:** `MovimientoCandidato`/`LineaParaMatching`/`evaluarLinea` (T3) consumidos en T4; contrato de FormData de T6 consumido en T7; `LineaDistribucion` siempre de `lib/movimientos/distribucion`.
- **Puntos donde el implementador DEBE leer código antes de escribir:** `lib/extractor/recibo.ts` (T2), `empleados/actions.ts` y `recibos-upload.tsx` (T6), `empleados/prepagas/page.tsx` y `distribucion-editor.tsx` (T7), `iconos.tsx` (T6).
- **Deviación consciente:** `ingestarResumen` ancla el período al mes actual hasta que la extracción declare el real (el resumen es la autoridad de su propio período).
