# Costos de empleados (recibos de sueldo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo de empleados: ingesta de PDF multi-recibo con extracción LLM, cuenta de costo por empleado por período, distribución a centro de costo/cliente/proyecto, vínculo de comprobantes a empleados, y consolidación "Costos de personal" en el proto-P&L (vista Movimientos). Sólo ADMINISTRADOR ve el detalle.

**Architecture:** Módulo propio (`Empleado` + `ReciboSueldo` + líneas de distribución propias) consolidado a tiempo de query — nada materializado. Se espejan los patrones existentes: `scopedDb` para aislamiento multi-empresa, `Job` + worker para extracción asíncrona, extractor Anthropic con tool forzado, `DistribucionEditor` y `validarDistribucion`/`importesPorLinea` para el reparto, `writeAudit` para auditoría, `requireEmpresa(slug, 'ADMINISTRADOR')` como guarda de rol.

**Tech Stack:** Next.js 14 (app router, server actions), Prisma 5 + Postgres, zod, `@anthropic-ai/sdk` (tool use forzado), `unpdf` (texto por página), vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-costos-empleados-design.md`

## Global Constraints

- Todo en castellano: nombres de dominio, mensajes, copy de UI, describe/it de tests.
- Importes `Decimal @db.Decimal(18, 2)` en Prisma; en memoria se opera en **centavos enteros** (patrón `importesPorLinea`).
- Porcentajes `Decimal @db.Decimal(7, 4)`, suman exactamente 100 (usar `validarDistribucion` — NO reimplementar).
- El cliente scoped **no soporta `upsert`** (tira ForbiddenError): usar `findFirst` + `create`/`update`.
- Migraciones aditivas con `npx prisma db push` (no hay migrations folder).
- Commits: mensajes estilo `feat(empleados): …` en castellano, **sin trailer Co-Authored-By ni atribución del asistente** (instrucción global del usuario).
- Los tests son unit/integration con vitest (`npm test`); la suite actual tiene 177 verdes y debe seguir verde.
- CUIL se normaliza con `normalizarCuit` de `@/lib/checks/cuit` (11 dígitos, sin guiones — mismo formato que CUIT).
- Desviaciones acordadas respecto del spec (documentadas acá, no re-discutir): (1) `EstadoRecibo` tiene sólo `PENDIENTE_REVISION | CONFIRMADO | ANULADO` — los estados PROCESANDO/ERROR del spec viven en la tabla `Job` porque el `ReciboSueldo` recién se crea después de la extracción; (2) la guarda anti-duplicado `(empresa, empleado, período, tipo)` se implementa **en código** (worker) y no como `@@unique` en DB, para poder conservar el recibo duplicado como fila ANULADO visible en la ficha.

---

### Task 1: Schema Prisma + aislamiento multi-empresa

**Files:**
- Modify: `prisma/schema.prisma` (enums + 5 modelos nuevos + back-relations)
- Modify: `lib/empresa/scope.ts:7-27` (SCOPED_MODELS / RELATION_SCOPE)
- Test: `tests/aislamiento-empresa.test.ts` (casos unitarios nuevos)

**Interfaces:**
- Produces: modelos Prisma `Empleado`, `EmpleadoDistribucionLinea`, `ReciboSueldo`, `ReciboDistribucionLinea`, `MovimientoEmpleado`; enums `TipoRecibo`, `EstadoRecibo`. Todos accesibles vía `scopedDb(empresaId)` con aislamiento.

- [ ] **Step 1: Escribir los tests de scope que van a fallar**

En `tests/aislamiento-empresa.test.ts`, dentro del `describe('applyEmpresaScope (unitario)')`, agregar:

```ts
  it('scopea los modelos de empleados', () => {
    expect(applyEmpresaScope('Empleado', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('ReciboSueldo', 'findMany', {}, 'emp1').where).toEqual({ empresaId: 'emp1' });
    expect(applyEmpresaScope('EmpleadoDistribucionLinea', 'findMany', {}, 'emp1').where).toEqual({
      empleado: { empresaId: 'emp1' },
    });
    expect(applyEmpresaScope('ReciboDistribucionLinea', 'findMany', {}, 'emp1').where).toEqual({
      recibo: { empresaId: 'emp1' },
    });
    expect(applyEmpresaScope('MovimientoEmpleado', 'findMany', {}, 'emp1').where).toEqual({
      movimiento: { empresaId: 'emp1' },
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/aislamiento-empresa.test.ts`
Expected: FAIL — `Empleado` no está en SCOPED_MODELS, el transform devuelve args sin tocar.

- [ ] **Step 3: Agregar los modelos al schema**

En `prisma/schema.prisma`, después del bloque de `Periodo` (línea ~375), agregar:

```prisma
// ---------- Empleados (Spec D: costos de personal) ----------

enum TipoRecibo {
  MENSUAL
  SAC
  VACACIONES
  LIQUIDACION_FINAL
  OTRO
}

enum EstadoRecibo {
  PENDIENTE_REVISION
  CONFIRMADO
  ANULADO
}

model Empleado {
  id           String    @id @default(cuid())
  empresaId    String
  nombre       String
  cuil         String // 11 dígitos normalizados; clave de matching en la ingesta
  legajo       String?
  categoria    String?
  sector       String?
  fechaIngreso DateTime?
  fechaEgreso  DateTime?
  activo       Boolean   @default(true)
  empresa      Empresa   @relation(fields: [empresaId], references: [id])
  distribucion EmpleadoDistribucionLinea[]
  recibos      ReciboSueldo[]
  vinculos     MovimientoEmpleado[]
  createdAt    DateTime  @default(now())

  @@unique([empresaId, cuil])
}

// Distribución por defecto de la ficha (se COPIA al recibo al confirmar).
model EmpleadoDistribucionLinea {
  id            String      @id @default(cuid())
  empleadoId    String
  centroCostoId String
  clienteId     String?
  proyectoId    String?
  porcentaje    Decimal     @db.Decimal(7, 4) // suman 100
  empleado      Empleado    @relation(fields: [empleadoId], references: [id], onDelete: Cascade)
  centroCosto   CentroCosto @relation("empleadoLineas", fields: [centroCostoId], references: [id])
  cliente       Cliente?    @relation("empleadoLineas", fields: [clienteId], references: [id])
  proyecto     Proyecto?    @relation("empleadoLineas", fields: [proyectoId], references: [id])
}

model ReciboSueldo {
  id         String       @id @default(cuid())
  empresaId  String
  empleadoId String
  periodoId  String
  tipo       TipoRecibo   @default(MENSUAL)
  estado     EstadoRecibo @default(PENDIENTE_REVISION)
  nota       String? // motivo de anulación (p.ej. duplicado) o advertencias de ingesta

  // Totales extraídos (positivos). costoTotalEmpleador es LA cifra que va al P&L.
  brutoRemunerativo       Decimal? @db.Decimal(18, 2)
  noRemunerativo          Decimal? @db.Decimal(18, 2)
  retenciones             Decimal? @db.Decimal(18, 2)
  sueldoNeto              Decimal? @db.Decimal(18, 2)
  contribucionesEmpleador Decimal? @db.Decimal(18, 2)
  costoTotalEmpleador     Decimal? @db.Decimal(18, 2)

  // Lista flexible de conceptos {concepto, unidad?, importe, naturaleza}:
  // otro modelo de recibo (otra empresa) no exige migración de schema.
  conceptos Json?

  // El PDF multi-recibo se guarda UNA vez; cada recibo apunta a su página.
  archivoKey    String?
  archivoNombre String?
  archivoMime   String?
  pagina        Int?

  extraccionRaw       Json?
  camposRevisar       Json?
  confianza           Json?
  tokensEntrada       Int?
  tokensSalida        Int?
  tokensCacheCreacion Int?
  tokensCacheLectura  Int?
  modeloExtractor     String?

  empresa      Empresa   @relation(fields: [empresaId], references: [id])
  empleado     Empleado  @relation(fields: [empleadoId], references: [id])
  periodo      Periodo   @relation(fields: [periodoId], references: [id])
  lineas       ReciboDistribucionLinea[]
  createdAt    DateTime  @default(now())
  confirmadoAt DateTime?

  // La guarda anti-duplicado (empleado, período, tipo) es de código, no @@unique:
  // el duplicado se conserva como fila ANULADO visible en la ficha.
  @@index([empresaId, empleadoId, periodoId])
}

// Distribución EFECTIVA del recibo: copia de la ficha al confirmar, editable
// sólo en ese recibo. Copia, no referencia: cambiar la ficha no reescribe historia.
model ReciboDistribucionLinea {
  id            String       @id @default(cuid())
  reciboId      String
  centroCostoId String
  clienteId     String?
  proyectoId    String?
  porcentaje    Decimal      @db.Decimal(7, 4)
  recibo        ReciboSueldo @relation(fields: [reciboId], references: [id], onDelete: Cascade)
  centroCosto   CentroCosto  @relation("reciboLineas", fields: [centroCostoId], references: [id])
  cliente       Cliente?     @relation("reciboLineas", fields: [clienteId], references: [id])
  proyecto      Proyecto?    @relation("reciboLineas", fields: [proyectoId], references: [id])
}

// Vínculo comprobante→empleado (prepaga, etc.). Montos, no porcentajes: una
// factura única reparte importes distintos y el remanente sigue siendo gasto
// general. La porción vinculada sigue la distribución de la FICHA del empleado.
model MovimientoEmpleado {
  id           String     @id @default(cuid())
  movimientoId String
  empleadoId   String
  monto        Decimal    @db.Decimal(18, 2)
  movimiento   Movimiento @relation(fields: [movimientoId], references: [id], onDelete: Cascade)
  empleado     Empleado   @relation(fields: [empleadoId], references: [id])
  createdAt    DateTime   @default(now())

  @@unique([movimientoId, empleadoId])
}
```

Y agregar las back-relations en los modelos existentes (el nombre del campo importa; Prisma valida ambas puntas):

- `Empresa`: `empleados Empleado[]` y `recibosSueldo ReciboSueldo[]`
- `Periodo`: `recibosSueldo ReciboSueldo[]`
- `Movimiento`: `vinculosEmpleados MovimientoEmpleado[]`
- `CentroCosto`: `empleadoLineas EmpleadoDistribucionLinea[] @relation("empleadoLineas")` y `reciboLineas ReciboDistribucionLinea[] @relation("reciboLineas")`
- `Cliente`: ídem `CentroCosto` (mismos nombres de relación)
- `Proyecto`: ídem `CentroCosto` (mismos nombres de relación)

- [ ] **Step 4: Extender el scope**

En `lib/empresa/scope.ts`:

```ts
export const SCOPED_MODELS = new Set([
  // ... existentes sin tocar ...
  'Empleado',
  'ReciboSueldo',
]);

const RELATION_SCOPE: Record<string, (empresaId: string) => object> = {
  MovimientoLinea: (empresaId) => ({ movimiento: { empresaId } }),
  PlantillaDistribucionLinea: (empresaId) => ({ plantilla: { empresaId } }),
  EmpleadoDistribucionLinea: (empresaId) => ({ empleado: { empresaId } }),
  ReciboDistribucionLinea: (empresaId) => ({ recibo: { empresaId } }),
  MovimientoEmpleado: (empresaId) => ({ movimiento: { empresaId } }),
};
```

- [ ] **Step 5: Aplicar el schema y regenerar el cliente**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema" sin warnings de data loss (todo aditivo).

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/aislamiento-empresa.test.ts && npx tsc --noEmit`
Expected: PASS y typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma lib/empresa/scope.ts tests/aislamiento-empresa.test.ts
git commit -m "feat(empleados): modelos de empleado, recibo y vínculo con aislamiento por empresa"
```

---

### Task 2: Control aritmético del recibo

**Files:**
- Create: `lib/empleados/aritmetica.ts`
- Test: `tests/empleados-aritmetica.test.ts`

**Interfaces:**
- Produces:
  - `type TotalesRecibo = { brutoRemunerativo: number|null; noRemunerativo: number|null; retenciones: number|null; sueldoNeto: number|null; contribucionesEmpleador: number|null; costoTotalEmpleador: number|null }`
  - `verificarAritmeticaRecibo(t: TotalesRecibo): Record<string, string>` — mapa campo→motivo (vacío = todo cierra)
  - `calcularCostoTotal(t: TotalesRecibo): number | null` — `bruto + noRem + contribuciones` (null si falta bruto o contribuciones)

- [ ] **Step 1: Escribir los tests que van a fallar**

`tests/empleados-aritmetica.test.ts` — los fixtures salen del PDF real de Ewwo agosto 2026:

```ts
import { describe, it, expect } from 'vitest';
import { verificarAritmeticaRecibo, calcularCostoTotal, type TotalesRecibo } from '@/lib/empleados/aritmetica';

// Página 4 del PDF real (Fazzini): caso estándar que cierra exacto.
const FAZZINI: TotalesRecibo = {
  brutoRemunerativo: 4_770_000,
  noRemunerativo: 0.06,
  retenciones: 913_186.06,
  sueldoNeto: 3_856_814,
  contribucionesEmpleador: 1_223_553.96,
  costoTotalEmpleador: 5_993_554.02,
};

// Página 1 (Frontera): con Recupero de Adelanto de Sueldos entre las retenciones.
// El adelanto baja el NETO pero no cambia el costo empleador.
const FRONTERA: TotalesRecibo = {
  brutoRemunerativo: 4_770_000,
  noRemunerativo: 0.8,
  retenciones: 3_419_512.8,
  sueldoNeto: 1_350_488,
  contribucionesEmpleador: 1_221_290.34,
  costoTotalEmpleador: 5_991_291.14,
};

// Página 11 (Aranda, media jornada): el sueldo devengado es la mitad del de header.
const ARANDA: TotalesRecibo = {
  brutoRemunerativo: 780_000,
  noRemunerativo: 0,
  retenciones: 156_000,
  sueldoNeto: 624_000,
  contribucionesEmpleador: 248_347.29,
  costoTotalEmpleador: 1_028_347.29,
};

describe('verificarAritmeticaRecibo', () => {
  it('cierra los tres casos reales del PDF de Ewwo', () => {
    expect(verificarAritmeticaRecibo(FAZZINI)).toEqual({});
    expect(verificarAritmeticaRecibo(FRONTERA)).toEqual({});
    expect(verificarAritmeticaRecibo(ARANDA)).toEqual({});
  });

  it('tolera hasta $1 de redondeo', () => {
    expect(verificarAritmeticaRecibo({ ...ARANDA, sueldoNeto: 624_000.99 })).toEqual({});
  });

  it('flaggea neto que no cierra', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, sueldoNeto: 600_000 });
    expect(r.sueldoNeto).toMatch(/no cierra/);
  });

  it('flaggea costo total que no cierra', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, costoTotalEmpleador: 999_999 });
    expect(r.costoTotalEmpleador).toMatch(/no cierra/);
  });

  it('flaggea costo total faltante', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, costoTotalEmpleador: null });
    expect(r.costoTotalEmpleador).toMatch(/No se pudo extraer/);
  });

  it('no exige el chequeo de neto si faltan sus insumos', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, retenciones: null });
    expect(r.retenciones).toBeDefined();
    expect(r.sueldoNeto).toBeUndefined();
  });
});

describe('calcularCostoTotal', () => {
  it('calcula bruto + noRem + contribuciones', () => {
    expect(calcularCostoTotal(ARANDA)).toBeCloseTo(1_028_347.29, 2);
  });
  it('devuelve null si falta bruto o contribuciones', () => {
    expect(calcularCostoTotal({ ...ARANDA, brutoRemunerativo: null })).toBeNull();
    expect(calcularCostoTotal({ ...ARANDA, contribucionesEmpleador: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/empleados-aritmetica.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`lib/empleados/aritmetica.ts`:

```ts
// Control aritmético del recibo (misma filosofía que lib/checks/aritmetica de
// comprobantes): todo en centavos enteros, con tolerancia de $1 porque los
// recibos traen concepto "Redondeo".

export type TotalesRecibo = {
  brutoRemunerativo: number | null;
  noRemunerativo: number | null;
  retenciones: number | null;
  sueldoNeto: number | null;
  contribucionesEmpleador: number | null;
  costoTotalEmpleador: number | null;
};

const TOLERANCIA_CENTAVOS = 100;

const cents = (v: number | null): number | null => (v == null ? null : Math.round(v * 100));

export function verificarAritmeticaRecibo(t: TotalesRecibo): Record<string, string> {
  const revisar: Record<string, string> = {};
  const bruto = cents(t.brutoRemunerativo);
  const noRem = cents(t.noRemunerativo) ?? 0;
  const ret = cents(t.retenciones);
  const neto = cents(t.sueldoNeto);
  const contrib = cents(t.contribucionesEmpleador);
  const costo = cents(t.costoTotalEmpleador);

  if (bruto == null) revisar.brutoRemunerativo = 'No se pudo extraer el bruto remunerativo';
  if (ret == null) revisar.retenciones = 'No se pudieron extraer las retenciones';
  if (neto == null) revisar.sueldoNeto = 'No se pudo extraer el sueldo neto';
  if (contrib == null) revisar.contribucionesEmpleador = 'No se pudieron extraer las contribuciones del empleador';
  if (costo == null) revisar.costoTotalEmpleador = 'No se pudo extraer el costo total empleador';

  if (bruto != null && ret != null && neto != null) {
    const esperado = bruto - ret + noRem;
    if (Math.abs(esperado - neto) > TOLERANCIA_CENTAVOS) {
      revisar.sueldoNeto = `El neto no cierra: bruto − retenciones + no rem = ${(esperado / 100).toFixed(2)}, el recibo dice ${(neto / 100).toFixed(2)}`;
    }
  }
  if (bruto != null && contrib != null && costo != null) {
    const esperado = bruto + noRem + contrib;
    if (Math.abs(esperado - costo) > TOLERANCIA_CENTAVOS) {
      revisar.costoTotalEmpleador = `El costo total no cierra: bruto + no rem + contribuciones = ${(esperado / 100).toFixed(2)}, el recibo dice ${(costo / 100).toFixed(2)}`;
    }
  }
  return revisar;
}

/** Costo total calculado cuando el modelo de recibo no lo imprime. */
export function calcularCostoTotal(t: TotalesRecibo): number | null {
  const bruto = cents(t.brutoRemunerativo);
  const contrib = cents(t.contribucionesEmpleador);
  if (bruto == null || contrib == null) return null;
  return (bruto + (cents(t.noRemunerativo) ?? 0) + contrib) / 100;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/empleados-aritmetica.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/empleados/aritmetica.ts tests/empleados-aritmetica.test.ts
git commit -m "feat(empleados): control aritmético del recibo con tolerancia de redondeo"
```

---

### Task 3: Schema y extractor de recibos (LLM + mock)

**Files:**
- Create: `lib/extractor/recibo-schema.ts`
- Create: `lib/extractor/recibo.ts` (interfaz + factory + Anthropic + mock en un solo archivo: el extractor de recibos es más chico que el de comprobantes)
- Test: `tests/recibo-schema.test.ts`

**Interfaces:**
- Consumes: patrón de `lib/extractor/anthropic.ts` (tool forzado) y `lib/extractor/index.ts` (`UsoTokens`).
- Produces:
  - `type ReciboExtraccion` (zod-inferred), `reciboExtraccionSchema`, `TIPOS_RECIBO`, `NATURALEZAS_CONCEPTO`
  - `getReciboExtractor(): ReciboExtractor` con `extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult>`
  - `type ReciboExtractorInput = { texto: string | null; buffer: Buffer; mime: string; pagina: number }`
  - `type ReciboExtractorResult = { extraccion: ReciboExtraccion; uso: UsoTokens | null }`

- [ ] **Step 1: Escribir el test del schema que va a fallar**

`tests/recibo-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reciboExtraccionSchema } from '@/lib/extractor/recibo-schema';

describe('reciboExtraccionSchema', () => {
  it('parsea una extracción completa (caso Ewwo)', () => {
    const r = reciboExtraccionSchema.parse({
      nombre: 'FAZZINI SANTIAGO OSCAR',
      cuil: '20253767872',
      legajo: '00000004',
      categoriaLaboral: 'PROJECT MANAGER',
      sector: null,
      fechaIngreso: '2016-06-01',
      periodoAnio: 2026,
      periodoMes: 8,
      tipo: 'MENSUAL',
      conceptos: [
        { concepto: 'Sueldo Mensual', unidad: '31', importe: 4770000, naturaleza: 'REMUNERATIVO' },
        { concepto: 'Jubilacion 11%', unidad: null, importe: 505427.81, naturaleza: 'RETENCION' },
        { concepto: 'Contribución de Seg. Social', unidad: '18,90%', importe: 900269.34, naturaleza: 'CONTRIBUCION_EMPLEADOR' },
      ],
      brutoRemunerativo: 4770000,
      noRemunerativo: 0.06,
      retenciones: 913186.06,
      sueldoNeto: 3856814,
      contribucionesEmpleador: 1223553.96,
      costoTotalEmpleador: 5993554.02,
      confianza: { cuil: 1 },
      observaciones: null,
    });
    expect(r.cuil).toBe('20253767872');
    expect(r.conceptos).toHaveLength(3);
  });

  it('aplica defaults en campos ausentes', () => {
    const r = reciboExtraccionSchema.parse({ nombre: null, cuil: null, periodoAnio: null, periodoMes: null });
    expect(r.tipo).toBe('MENSUAL');
    expect(r.conceptos).toEqual([]);
    expect(r.costoTotalEmpleador).toBeNull();
  });

  it('rechaza mes fuera de rango y naturaleza desconocida', () => {
    expect(() => reciboExtraccionSchema.parse({ nombre: null, cuil: null, periodoAnio: 2026, periodoMes: 13 })).toThrow();
    expect(() =>
      reciboExtraccionSchema.parse({
        nombre: null, cuil: null, periodoAnio: 2026, periodoMes: 1,
        conceptos: [{ concepto: 'X', importe: 1, naturaleza: 'OTRA_COSA' }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/recibo-schema.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el schema**

`lib/extractor/recibo-schema.ts`:

```ts
import { z } from 'zod';

// Schema estricto de la extracción LLM de UN recibo de sueldo (una página del
// PDF multi-recibo). Agnóstico del modelo de recibo: los conceptos son una
// lista flexible con naturaleza, no un formulario fijo.

export const TIPOS_RECIBO = ['MENSUAL', 'SAC', 'VACACIONES', 'LIQUIDACION_FINAL', 'OTRO'] as const;
export const NATURALEZAS_CONCEPTO = ['REMUNERATIVO', 'RETENCION', 'NO_REMUNERATIVO', 'CONTRIBUCION_EMPLEADOR'] as const;

export const reciboExtraccionSchema = z.object({
  nombre: z.string().nullable(),
  cuil: z.string().nullable(),
  legajo: z.string().nullable().default(null),
  categoriaLaboral: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  periodoAnio: z.number().int().nullable(),
  periodoMes: z.number().int().min(1).max(12).nullable(),
  tipo: z.enum(TIPOS_RECIBO).default('MENSUAL'),
  conceptos: z
    .array(
      z.object({
        concepto: z.string(),
        unidad: z.string().nullable().default(null),
        importe: z.number(),
        naturaleza: z.enum(NATURALEZAS_CONCEPTO),
      }),
    )
    .default([]),
  brutoRemunerativo: z.number().nullable().default(null),
  noRemunerativo: z.number().nullable().default(null),
  retenciones: z.number().nullable().default(null),
  sueldoNeto: z.number().nullable().default(null),
  contribucionesEmpleador: z.number().nullable().default(null),
  costoTotalEmpleador: z.number().nullable().default(null),
  confianza: z.record(z.number()).default({}),
  observaciones: z.string().nullable().default(null),
});

export type ReciboExtraccion = z.infer<typeof reciboExtraccionSchema>;

// JSON Schema para el tool forzado (patrón extraccionJsonSchema).
export const reciboExtraccionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nombre: { type: ['string', 'null'], description: 'Apellido y nombre del empleado' },
    cuil: { type: ['string', 'null'], description: 'CUIL, solo 11 dígitos sin guiones' },
    legajo: { type: ['string', 'null'] },
    categoriaLaboral: { type: ['string', 'null'] },
    sector: { type: ['string', 'null'], description: 'Sector o tarea desempeñada' },
    fechaIngreso: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    periodoAnio: { type: ['integer', 'null'], description: 'Año del período abonado' },
    periodoMes: { type: ['integer', 'null'], description: 'Mes del período abonado (1-12)' },
    tipo: { type: 'string', enum: [...TIPOS_RECIBO] },
    conceptos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          concepto: { type: 'string' },
          unidad: { type: ['string', 'null'], description: 'Unidad/cantidad/porcentaje tal como figura' },
          importe: { type: 'number' },
          naturaleza: { type: 'string', enum: [...NATURALEZAS_CONCEPTO] },
        },
        required: ['concepto', 'importe', 'naturaleza'],
      },
    },
    brutoRemunerativo: { type: ['number', 'null'], description: 'Total remunerativo del recibo' },
    noRemunerativo: { type: ['number', 'null'], description: 'Total no remunerativo' },
    retenciones: { type: ['number', 'null'], description: 'Total de retenciones/deducciones del empleado' },
    sueldoNeto: { type: ['number', 'null'] },
    contribucionesEmpleador: { type: ['number', 'null'], description: 'Subtotal de contribuciones del empleador (cargas patronales + ART + SCVO)' },
    costoTotalEmpleador: { type: ['number', 'null'], description: 'COSTO TOTAL EMPLEADOR si el recibo lo imprime; null si no figura' },
    confianza: { type: 'object', additionalProperties: { type: 'number' } },
    observaciones: { type: ['string', 'null'] },
  },
  required: ['nombre', 'cuil', 'periodoAnio', 'periodoMes', 'tipo'],
} as const;
```

- [ ] **Step 4: Implementar el extractor (Anthropic + mock + factory)**

`lib/extractor/recibo.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { reciboExtraccionSchema, reciboExtraccionJsonSchema, type ReciboExtraccion } from './recibo-schema';
import type { UsoTokens } from './index';

// Extractor de recibos de sueldo: recibe UNA página (texto si el PDF tiene capa
// de texto; si no, el PDF entero como document block con instrucción de leer
// solo esa página). Mismo patrón de tool forzado que AnthropicExtractor.

export type ReciboExtractorInput = {
  texto: string | null; // texto de la página, si el PDF tiene capa de texto
  buffer: Buffer; // PDF completo (fallback visión)
  mime: string;
  pagina: number; // 1-based
};

export type ReciboExtractorResult = { extraccion: ReciboExtraccion; uso: UsoTokens | null };

export interface ReciboExtractor {
  extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult>;
}

const SYSTEM_PROMPT = `Sos un extractor de datos de recibos de sueldo argentinos. Cada empresa usa un modelo de recibo distinto: no asumas un layout fijo.
Reglas estrictas:
- NO inventes datos: ante la duda, devolvé null en ese campo.
- Los importes van como números positivos.
- CUIL: solo los 11 dígitos, sin guiones.
- Fechas en formato YYYY-MM-DD.
- "periodoAnio"/"periodoMes": del período ABONADO (p.ej. "Mensual - Agosto 2026" → 2026 / 8).
- "tipo": SAC si es aguinaldo (1ra o 2da cuota), VACACIONES si es liquidación de vacaciones, LIQUIDACION_FINAL si es liquidación final; MENSUAL para el sueldo del mes.
- Cargá TODOS los conceptos con su naturaleza: REMUNERATIVO (haberes), RETENCION (deducciones al empleado: jubilación, obra social, adelantos, retención 4ta categoría), NO_REMUNERATIVO, CONTRIBUCION_EMPLEADOR (cargas patronales, ART, seguro colectivo).
- "costoTotalEmpleador": SOLO si el recibo lo imprime explícitamente; si no figura, null (el sistema lo calcula).
- Completá "confianza" con un valor 0..1 por campo extraído.`;

class AnthropicReciboExtractor implements ReciboExtractor {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private model = process.env.EXTRACTOR_MODEL ?? 'claude-opus-4-8';

  async extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (input.texto && input.texto.trim().length > 100) {
      content.push({ type: 'text', text: `Texto extraído de la página ${input.pagina} del PDF de recibos:\n\n${input.texto.slice(0, 50000)}` });
      content.push({ type: 'text', text: 'Extraé los datos del recibo usando la herramienta.' });
    } else {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
      });
      content.push({
        type: 'text',
        text: `El PDF contiene un recibo por página. Extraé usando la herramienta SOLO los datos del recibo de la página ${input.pagina}.`,
      });
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ name: 'registrar_recibo', description: 'Registra los datos extraídos del recibo de sueldo', input_schema: reciboExtraccionJsonSchema as never }],
      tool_choice: { type: 'tool', name: 'registrar_recibo' },
      messages: [{ role: 'user', content }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('El modelo no devolvió la extracción estructurada');

    const u = response.usage;
    return {
      extraccion: reciboExtraccionSchema.parse(toolUse.input),
      uso: {
        entrada: u.input_tokens ?? 0,
        salida: u.output_tokens ?? 0,
        cacheCreacion: u.cache_creation_input_tokens ?? 0,
        cacheLectura: u.cache_read_input_tokens ?? 0,
        modelo: this.model,
      },
    };
  }
}

/** Mock determinístico para dev/tests sin API key: un empleado por página. */
class MockReciboExtractor implements ReciboExtractor {
  async extract(input: ReciboExtractorInput): Promise<ReciboExtractorResult> {
    const n = input.pagina;
    const bruto = 1_000_000 + n * 10_000;
    return {
      extraccion: reciboExtraccionSchema.parse({
        nombre: `EMPLEADO MOCK ${n}`,
        cuil: `2000000${String(n).padStart(3, '0')}0`,
        legajo: String(n).padStart(8, '0'),
        categoriaLaboral: 'MOCK',
        sector: null,
        fechaIngreso: '2020-01-01',
        periodoAnio: 2026,
        periodoMes: 8,
        tipo: 'MENSUAL',
        conceptos: [{ concepto: 'Sueldo Mensual', unidad: '31', importe: bruto, naturaleza: 'REMUNERATIVO' }],
        brutoRemunerativo: bruto,
        noRemunerativo: 0,
        retenciones: bruto * 0.17,
        sueldoNeto: bruto * 0.83,
        contribucionesEmpleador: bruto * 0.26,
        costoTotalEmpleador: bruto * 1.26,
        confianza: { cuil: 1 },
      }),
      uso: null,
    };
  }
}

/** EXTRACTOR_MODE=mock (default) | real — misma llave que el extractor de comprobantes. */
export function getReciboExtractor(): ReciboExtractor {
  const mode = process.env.EXTRACTOR_MODE ?? 'mock';
  if (mode === 'real') {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[recibo-extractor] EXTRACTOR_MODE=real sin ANTHROPIC_API_KEY: usando mock.');
      return new MockReciboExtractor();
    }
    return new AnthropicReciboExtractor();
  }
  return new MockReciboExtractor();
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run tests/recibo-schema.test.ts && npx tsc --noEmit`
Expected: PASS + typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/extractor/recibo-schema.ts lib/extractor/recibo.ts tests/recibo-schema.test.ts
git commit -m "feat(empleados): extractor LLM de recibos de sueldo con schema flexible"
```

---

### Task 4: Utilidades de PDF por página

**Files:**
- Create: `lib/empleados/pdf.ts`
- Test: `tests/empleados-pdf.test.ts`

**Interfaces:**
- Produces: `contarPaginasPdf(buffer: Buffer): Promise<number>`; `textoDePagina(buffer: Buffer, pagina: number): Promise<string | null>` (1-based; null si no hay capa de texto o la página no existe).

- [ ] **Step 1: Escribir el test que va a fallar**

`tests/empleados-pdf.test.ts` — usa el PDF real del repo como fixture:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { contarPaginasPdf, textoDePagina } from '@/lib/empleados/pdf';

const PDF = readFileSync(join(process.cwd(), 'Docs/RecibosSueldoEwwo/Recibos_Ewwo Consulting SRL_2026-08.pdf'));

describe('pdf de recibos', () => {
  it('cuenta las 13 páginas del PDF real', async () => {
    expect(await contarPaginasPdf(PDF)).toBe(13);
  });

  it('extrae el texto de una página puntual (1-based)', async () => {
    const p4 = await textoDePagina(PDF, 4);
    expect(p4).toContain('FAZZINI');
    const p12 = await textoDePagina(PDF, 12);
    expect(p12).toContain('GODOY');
  });

  it('devuelve null para una página inexistente', async () => {
    expect(await textoDePagina(PDF, 99)).toBeNull();
  });

  it('devuelve null si el buffer no es un PDF', async () => {
    expect(await textoDePagina(Buffer.from('no soy un pdf'), 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/empleados-pdf.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`lib/empleados/pdf.ts`:

```ts
// Split lógico del PDF multi-recibo: no se generan archivos por página, solo
// se cuenta y se extrae el texto de la página pedida (unpdf, igual que
// AnthropicExtractor.tryPdfText pero sin mergePages).

export async function contarPaginasPdf(buffer: Buffer): Promise<number> {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  return doc.numPages;
}

export async function textoDePagina(buffer: Buffer, pagina: number): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    if (pagina < 1 || pagina > doc.numPages) return null;
    const { text } = await extractText(doc, { mergePages: false });
    return text[pagina - 1] ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/empleados-pdf.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/empleados/pdf.ts tests/empleados-pdf.test.ts
git commit -m "feat(empleados): utilidades de PDF por página para el split de recibos"
```

---

### Task 5: Decisión de estado del recibo

**Files:**
- Create: `lib/empleados/decision.ts`
- Test: `tests/empleados-decision.test.ts`

**Interfaces:**
- Produces: `decidirEstadoRecibo(params: { camposRevisar: Record<string, string>; tieneDistribucion: boolean; periodoCerrado: boolean; duplicado: boolean }): { estado: 'PENDIENTE_REVISION' | 'CONFIRMADO' | 'ANULADO'; nota: string | null }`

- [ ] **Step 1: Escribir el test que va a fallar**

`tests/empleados-decision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decidirEstadoRecibo } from '@/lib/empleados/decision';

const base = { camposRevisar: {}, tieneDistribucion: true, periodoCerrado: false, duplicado: false };

describe('decidirEstadoRecibo', () => {
  it('caso feliz: aritmética cierra + ficha con distribución → CONFIRMADO directo', () => {
    expect(decidirEstadoRecibo(base)).toEqual({ estado: 'CONFIRMADO', nota: null });
  });

  it('duplicado → ANULADO con nota, gana sobre todo lo demás', () => {
    const r = decidirEstadoRecibo({ ...base, duplicado: true, periodoCerrado: true });
    expect(r.estado).toBe('ANULADO');
    expect(r.nota).toMatch(/duplicado/i);
  });

  it('período cerrado → PENDIENTE_REVISION con nota (nunca entra solo a un mes cerrado)', () => {
    const r = decidirEstadoRecibo({ ...base, periodoCerrado: true });
    expect(r.estado).toBe('PENDIENTE_REVISION');
    expect(r.nota).toMatch(/cerrado/i);
  });

  it('campos flaggeados → PENDIENTE_REVISION', () => {
    expect(decidirEstadoRecibo({ ...base, camposRevisar: { sueldoNeto: 'no cierra' } }).estado).toBe('PENDIENTE_REVISION');
  });

  it('empleado sin distribución → PENDIENTE_REVISION', () => {
    expect(decidirEstadoRecibo({ ...base, tieneDistribucion: false }).estado).toBe('PENDIENTE_REVISION');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/empleados-decision.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`lib/empleados/decision.ts`:

```ts
// Decisión de estado post-extracción (pura, sin DB): espeja la filosofía de
// decidirAutovalidacion de comprobantes. El caso feliz mensual es CONFIRMADO
// directo: subís el PDF y los recibos quedan listos sin tocar nada.

export type DecisionRecibo = {
  estado: 'PENDIENTE_REVISION' | 'CONFIRMADO' | 'ANULADO';
  nota: string | null;
};

export function decidirEstadoRecibo(params: {
  camposRevisar: Record<string, string>;
  tieneDistribucion: boolean;
  periodoCerrado: boolean;
  duplicado: boolean;
}): DecisionRecibo {
  if (params.duplicado) {
    return { estado: 'ANULADO', nota: 'Duplicado: ya existe un recibo de este empleado para el mismo período y tipo' };
  }
  if (params.periodoCerrado) {
    return { estado: 'PENDIENTE_REVISION', nota: 'El período del recibo está cerrado: requiere revisión manual' };
  }
  if (Object.keys(params.camposRevisar).length > 0 || !params.tieneDistribucion) {
    return { estado: 'PENDIENTE_REVISION', nota: null };
  }
  return { estado: 'CONFIRMADO', nota: null };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/empleados-decision.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/empleados/decision.ts tests/empleados-decision.test.ts
git commit -m "feat(empleados): decisión de estado del recibo post-extracción"
```

---

### Task 6: Pipeline de ingesta de recibos + registro en worker

**Files:**
- Create: `lib/empleados/ingesta.ts`
- Modify: `lib/jobs.ts:7` (`TipoJob` += `'EXTRACCION_RECIBO'`)
- Modify: `worker.ts:18-33` (case nuevo)

**Interfaces:**
- Consumes: `getFileStorage()` (`lib/storage`), `enqueueJob` (`lib/jobs`), `contarPaginasPdf`/`textoDePagina` (Task 4), `getReciboExtractor` (Task 3), `verificarAritmeticaRecibo`/`calcularCostoTotal` (Task 2), `decidirEstadoRecibo` (Task 5), `normalizarCuit` (`lib/checks/cuit`), `getOrCreatePeriodo` (`lib/periodos`), `validarDistribucion` (`lib/movimientos/distribucion`), `writeAudit` (`lib/audit`), `scopedDb`.
- Produces:
  - `ingestarRecibos(params: { empresaId: string; usuarioId: string; buffer: Buffer; filename: string; mime: string }): Promise<{ paginas: number }>`
  - `procesarExtraccionRecibo(payload: { empresaId: string; archivoKey: string; archivoNombre: string; archivoMime: string; pagina: number; usuarioId: string }): Promise<void>`

- [ ] **Step 1: Implementar la ingesta**

`lib/empleados/ingesta.ts` (no hay test unitario del pipeline con DB — la lógica decidible ya está testeada pura en Tasks 2/5; la integración se verifica e2e en Task 12):

```ts
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { enqueueJob } from '@/lib/jobs';
import { writeAudit } from '@/lib/audit';
import { getOrCreatePeriodo } from '@/lib/periodos';
import { normalizarCuit } from '@/lib/checks/cuit';
import { validarDistribucion } from '@/lib/movimientos/distribucion';
import { DomainError } from '@/lib/errors';
import { contarPaginasPdf, textoDePagina } from './pdf';
import { getReciboExtractor } from '@/lib/extractor/recibo';
import { verificarAritmeticaRecibo, calcularCostoTotal, type TotalesRecibo } from './aritmetica';
import { decidirEstadoRecibo } from './decision';

// Pipeline de recibos: PDF multi-recibo -> storage (una vez) -> un Job
// EXTRACCION_RECIBO por página -> el worker extrae, matchea por CUIL, corre la
// aritmética y decide estado. El ReciboSueldo nace DESPUÉS de la extracción
// (antes no se sabe de qué empleado es); el progreso se mira por la tabla Job.

export async function ingestarRecibos(params: {
  empresaId: string;
  usuarioId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{ paginas: number }> {
  if (params.mime !== 'application/pdf') throw new DomainError('Los recibos se cargan como PDF.');
  const paginas = await contarPaginasPdf(params.buffer).catch(() => 0);
  if (!paginas) throw new DomainError('No se pudo leer el PDF de recibos.');

  const storage = getFileStorage();
  const { key } = await storage.put(params.buffer, {
    filename: params.filename,
    mime: params.mime,
    empresaId: params.empresaId,
  });

  for (let pagina = 1; pagina <= paginas; pagina++) {
    await enqueueJob(
      'EXTRACCION_RECIBO',
      {
        empresaId: params.empresaId,
        archivoKey: key,
        archivoNombre: params.filename,
        archivoMime: params.mime,
        pagina,
        usuarioId: params.usuarioId,
      },
      params.empresaId,
    );
  }
  return { paginas };
}

/** Extracción de UNA página del PDF de recibos (la corre el worker). */
export async function procesarExtraccionRecibo(payload: {
  empresaId: string;
  archivoKey: string;
  archivoNombre: string;
  archivoMime: string;
  pagina: number;
  usuarioId: string;
}): Promise<void> {
  const db = scopedDb(payload.empresaId);
  const buffer = await getFileStorage().get(payload.archivoKey);
  const texto = await textoDePagina(buffer, payload.pagina);

  const { extraccion, uso } = await getReciboExtractor().extract({
    texto,
    buffer,
    mime: payload.archivoMime,
    pagina: payload.pagina,
  });

  const camposRevisar: Record<string, string> = {};

  // --- Empleado: matching por CUIL, alta automática si no existe ---
  const cuil = extraccion.cuil ? normalizarCuit(extraccion.cuil) : null;
  if (!cuil) throw new Error(`Página ${payload.pagina}: no se pudo extraer el CUIL del recibo`);
  let empleado = await db.empleado.findFirst({ where: { cuil }, include: { distribucion: true } });
  if (!empleado) {
    const creado = await db.empleado.create({
      data: {
        nombre: extraccion.nombre ?? `CUIL ${cuil}`,
        cuil,
        legajo: extraccion.legajo,
        categoria: extraccion.categoriaLaboral,
        sector: extraccion.sector,
        fechaIngreso: extraccion.fechaIngreso ? new Date(`${extraccion.fechaIngreso}T00:00:00Z`) : null,
      } as never,
    });
    await writeAudit(db, {
      entidad: 'Empleado',
      entidadId: creado.id,
      accion: 'CREAR',
      despues: { nombre: creado.nombre, cuil, desdeRecibo: true },
    });
    empleado = { ...creado, distribucion: [] };
    camposRevisar.empleado = 'Empleado nuevo dado de alta desde el recibo: revisá la ficha y cargale distribución';
  } else if (
    (extraccion.categoriaLaboral && empleado.categoria && extraccion.categoriaLaboral !== empleado.categoria) ||
    (extraccion.sector && empleado.sector && extraccion.sector !== empleado.sector)
  ) {
    // Drift de datos maestros: se flaggea, nunca se pisa la ficha en silencio.
    camposRevisar.empleado = 'La categoría o el sector del recibo difieren de la ficha del empleado';
  }

  // --- Período ---
  if (!extraccion.periodoAnio || !extraccion.periodoMes) {
    throw new Error(`Página ${payload.pagina}: no se pudo extraer el período del recibo`);
  }
  const fechaPeriodo = new Date(Date.UTC(extraccion.periodoAnio, extraccion.periodoMes - 1, 1));
  const periodo = await getOrCreatePeriodo(db, fechaPeriodo);

  // --- Totales + aritmética ---
  const totales: TotalesRecibo = {
    brutoRemunerativo: extraccion.brutoRemunerativo,
    noRemunerativo: extraccion.noRemunerativo,
    retenciones: extraccion.retenciones,
    sueldoNeto: extraccion.sueldoNeto,
    contribucionesEmpleador: extraccion.contribucionesEmpleador,
    costoTotalEmpleador: extraccion.costoTotalEmpleador,
  };
  if (totales.costoTotalEmpleador == null) {
    // El modelo de recibo no imprime el costo total: se calcula y se flaggea.
    const calculado = calcularCostoTotal(totales);
    if (calculado != null) {
      totales.costoTotalEmpleador = calculado;
      camposRevisar.costoTotalEmpleador = 'El recibo no imprime el costo total empleador: se calculó bruto + no rem + contribuciones';
    }
  }
  Object.assign(camposRevisar, verificarAritmeticaRecibo(totales));

  // --- Duplicado (guarda de código; ver plan, desviación 2) ---
  const preexistente = await db.reciboSueldo.findFirst({
    where: { empleadoId: empleado.id, periodoId: periodo.id, tipo: extraccion.tipo, estado: { not: 'ANULADO' } },
  });

  // --- Distribución de la ficha ---
  const lineasFicha = empleado.distribucion.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId ?? null,
    proyectoId: l.proyectoId ?? null,
    porcentaje: Number(l.porcentaje),
  }));
  let tieneDistribucion = false;
  try {
    validarDistribucion(lineasFicha);
    tieneDistribucion = true;
  } catch {
    /* ficha sin distribución completa */
  }

  const decision = decidirEstadoRecibo({
    camposRevisar,
    tieneDistribucion,
    periodoCerrado: periodo.estado === 'CERRADO',
    duplicado: preexistente != null,
  });

  const recibo = await db.reciboSueldo.create({
    data: {
      empleadoId: empleado.id,
      periodoId: periodo.id,
      tipo: extraccion.tipo,
      estado: decision.estado,
      nota: decision.nota,
      brutoRemunerativo: totales.brutoRemunerativo,
      noRemunerativo: totales.noRemunerativo,
      retenciones: totales.retenciones,
      sueldoNeto: totales.sueldoNeto,
      contribucionesEmpleador: totales.contribucionesEmpleador,
      costoTotalEmpleador: totales.costoTotalEmpleador,
      conceptos: extraccion.conceptos as never,
      archivoKey: payload.archivoKey,
      archivoNombre: payload.archivoNombre,
      archivoMime: payload.archivoMime,
      pagina: payload.pagina,
      extraccionRaw: extraccion as never,
      camposRevisar: camposRevisar as never,
      confianza: extraccion.confianza as never,
      tokensEntrada: uso?.entrada ?? null,
      tokensSalida: uso?.salida ?? null,
      tokensCacheCreacion: uso?.cacheCreacion ?? null,
      tokensCacheLectura: uso?.cacheLectura ?? null,
      modeloExtractor: uso?.modelo ?? null,
      confirmadoAt: decision.estado === 'CONFIRMADO' ? new Date() : null,
    } as never,
  });

  // CONFIRMADO directo hereda (copia) la distribución de la ficha.
  if (decision.estado === 'CONFIRMADO') {
    await prisma.reciboDistribucionLinea.createMany({
      data: lineasFicha.map((l) => ({
        reciboId: recibo.id,
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId,
        proyectoId: l.proyectoId,
        porcentaje: l.porcentaje,
      })),
    });
  }

  await writeAudit(db, {
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: decision.estado === 'CONFIRMADO' ? 'AUTO_CONFIRMAR' : decision.estado === 'ANULADO' ? 'AUTO_DUPLICADO' : 'EXTRAER',
    despues: {
      estado: decision.estado,
      empleado: empleado.nombre,
      periodo: `${extraccion.periodoAnio}-${extraccion.periodoMes}`,
      tipo: extraccion.tipo,
      costoTotalEmpleador: totales.costoTotalEmpleador,
      camposRevisar,
      pagina: payload.pagina,
    },
  });
}
```

- [ ] **Step 2: Registrar el tipo de job y el case del worker**

En `lib/jobs.ts`:

```ts
export type TipoJob = 'EXTRACCION' | 'ARCA' | 'RECURRENTES' | 'EMAIL_IN' | 'TELEGRAM_IN' | 'EXTRACCION_RECIBO';
```

En `worker.ts`, import + case (después del case `'ARCA'`):

```ts
import { procesarExtraccionRecibo } from '@/lib/empleados/ingesta';
// ...
      case 'EXTRACCION_RECIBO':
        await procesarExtraccionRecibo(payload as never);
        break;
```

(No hay hook de fallo final tipo `marcarErrorProcesamiento`: si el job agota reintentos queda `failed` en la tabla `Job` y la página de Empleados lo lista — Task 9.)

- [ ] **Step 3: Verificar typecheck y suite completa**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck limpio, suite completa verde (los tests nuevos de Tasks 1-5 incluidos).

- [ ] **Step 4: Commit**

```bash
git add lib/empleados/ingesta.ts lib/jobs.ts worker.ts
git commit -m "feat(empleados): pipeline de ingesta de recibos por página vía worker"
```

---

### Task 7: Resumen de costos de personal (consolidación query-time)

**Files:**
- Create: `lib/empleados/costos.ts`
- Modify: `lib/movimientos/query.ts:60-129` (`MovimientoConRelaciones` + ajuste por vínculos en `resumirMovimientos`)
- Test: `tests/empleados-costos.test.ts`

**Interfaces:**
- Consumes: `importesPorLinea`, `type LineaDistribucion` (`lib/movimientos/distribucion`).
- Produces:
  - `type ResumenPersonal = { total: number; porCentroCosto: Map<string, number>; porCliente: Map<string, number> }` — centavos, negativos (egreso)
  - `resumirCostosPersonal(recibos: ReciboParaResumen[], vinculos: VinculoParaResumen[]): ResumenPersonal`
  - `type ReciboParaResumen = { costoTotalEmpleador: unknown; lineas: { centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: unknown }[] }`
  - `type VinculoParaResumen = { monto: unknown; lineasEmpleado: ReciboParaResumen['lineas'] }`
  - En `query.ts`: `MovimientoConRelaciones` gana `vinculosEmpleados?: { monto: unknown }[]` y `montoVinculadoCentavos(mov): number`; `resumirMovimientos` descuenta lo vinculado.

- [ ] **Step 1: Escribir los tests que van a fallar**

`tests/empleados-costos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resumirCostosPersonal } from '@/lib/empleados/costos';
import { resumirMovimientos, montoVinculadoCentavos, type MovimientoConRelaciones } from '@/lib/movimientos/query';

const linea = (cc: string, pct: number, cliente: string | null = null) => ({
  centroCostoId: cc, clienteId: cliente, proyectoId: null, porcentaje: pct,
});

describe('resumirCostosPersonal', () => {
  it('distribuye el costo de los recibos por sus líneas, en centavos negativos', () => {
    const r = resumirCostosPersonal(
      [{ costoTotalEmpleador: 1000, lineas: [linea('bpo', 60, 'cliA'), linea('adm', 40)] }],
      [],
    );
    expect(r.total).toBe(-100_000);
    expect(r.porCentroCosto.get('bpo')).toBe(-60_000);
    expect(r.porCentroCosto.get('adm')).toBe(-40_000);
    expect(r.porCliente.get('cliA')).toBe(-60_000);
  });

  it('suma la porción vinculada según la distribución de la ficha del empleado', () => {
    const r = resumirCostosPersonal(
      [],
      [{ monto: 200, lineasEmpleado: [linea('bpo', 100)] }],
    );
    expect(r.total).toBe(-20_000);
    expect(r.porCentroCosto.get('bpo')).toBe(-20_000);
  });

  it('un recibo sin líneas suma al total sin desglose (defensivo)', () => {
    const r = resumirCostosPersonal([{ costoTotalEmpleador: 100, lineas: [] }], []);
    expect(r.total).toBe(-10_000);
    expect(r.porCentroCosto.size).toBe(0);
  });

  it('un vínculo de empleado sin distribución suma al total sin desglose', () => {
    const r = resumirCostosPersonal([], [{ monto: 50, lineasEmpleado: [] }]);
    expect(r.total).toBe(-5_000);
  });
});

describe('sin doble conteo: resumirMovimientos descuenta lo vinculado', () => {
  const movVinculado: MovimientoConRelaciones = {
    id: 'm1',
    estado: 'ASIGNADO',
    total: 1000, // factura de prepaga
    tipoComprobante: 'FACTURA_A',
    categoria: { tipo: 'EGRESO', nombre: 'Salud' },
    lineas: [{ centroCostoId: 'adm', clienteId: null, porcentaje: 100 }],
    vinculosEmpleados: [{ monto: 300 }],
  };

  it('montoVinculadoCentavos suma los vínculos', () => {
    expect(montoVinculadoCentavos(movVinculado)).toBe(30_000);
  });

  it('el movimiento aporta total − vinculado según sus propias líneas', () => {
    const r = resumirMovimientos([movVinculado]);
    expect(r.egresos).toBe(-70_000); // 1000 − 300 vinculados = 700 de gasto general
    expect(r.porCentroCosto.get('adm')).toBe(-70_000);
  });

  it('sin vínculos todo sigue igual que antes', () => {
    const r = resumirMovimientos([{ ...movVinculado, vinculosEmpleados: [] }]);
    expect(r.egresos).toBe(-100_000);
  });

  it('vínculos que cubren el total dejan el movimiento en cero para el libro', () => {
    const r = resumirMovimientos([{ ...movVinculado, vinculosEmpleados: [{ monto: 1000 }] }]);
    expect(r.egresos).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/empleados-costos.test.ts`
Expected: FAIL — `resumirCostosPersonal` y `montoVinculadoCentavos` no existen.

- [ ] **Step 3: Implementar `lib/empleados/costos.ts`**

```ts
import { importesPorLinea, type LineaDistribucion } from '@/lib/movimientos/distribucion';

// Consolidación query-time del bloque "Costos de personal" del proto-P&L:
// recibos CONFIRMADOS (por sus líneas copiadas) + porciones vinculadas de
// comprobantes ASIGNADOS (por la distribución de la ficha del empleado).
// Todo en centavos NEGATIVOS: el costo de personal es un egreso.

export type LineaResumen = { centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: unknown };
export type ReciboParaResumen = { costoTotalEmpleador: unknown; lineas: LineaResumen[] };
export type VinculoParaResumen = { monto: unknown; lineasEmpleado: LineaResumen[] };

export type ResumenPersonal = {
  total: number;
  porCentroCosto: Map<string, number>;
  porCliente: Map<string, number>;
};

function acumular(resumen: ResumenPersonal, firmado: number, lineas: LineaResumen[]): void {
  resumen.total += firmado;
  if (!lineas.length) return;
  const parsed: LineaDistribucion[] = lineas.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId,
    proyectoId: l.proyectoId,
    porcentaje: Number(l.porcentaje),
  }));
  try {
    const importes = importesPorLinea(firmado, parsed);
    parsed.forEach((l, i) => {
      resumen.porCentroCosto.set(l.centroCostoId, (resumen.porCentroCosto.get(l.centroCostoId) ?? 0) + importes[i]);
      if (l.clienteId) resumen.porCliente.set(l.clienteId, (resumen.porCliente.get(l.clienteId) ?? 0) + importes[i]);
    });
  } catch {
    // líneas inconsistentes: el total ya se sumó, se omite el desglose
  }
}

export function resumirCostosPersonal(recibos: ReciboParaResumen[], vinculos: VinculoParaResumen[]): ResumenPersonal {
  const resumen: ResumenPersonal = { total: 0, porCentroCosto: new Map(), porCliente: new Map() };
  for (const r of recibos) {
    if (r.costoTotalEmpleador == null) continue;
    acumular(resumen, -Math.round(Number(r.costoTotalEmpleador) * 100), r.lineas);
  }
  for (const v of vinculos) {
    if (v.monto == null) continue;
    acumular(resumen, -Math.round(Number(v.monto) * 100), v.lineasEmpleado);
  }
  return resumen;
}
```

- [ ] **Step 4: Ajustar `lib/movimientos/query.ts`**

En `MovimientoConRelaciones` agregar el campo opcional:

```ts
export type MovimientoConRelaciones = {
  id: string;
  estado: string;
  total: unknown;
  tipoComprobante: string | null;
  categoria: { tipo: 'INGRESO' | 'EGRESO'; nombre: string } | null;
  lineas: { centroCostoId: string; clienteId: string | null; porcentaje: unknown }[];
  /** Vínculos comprobante→empleado: su monto se descuenta del libro y computa en Costos de personal. */
  vinculosEmpleados?: { monto: unknown }[];
};
```

Nuevo helper (exportado, después de `totalFirmadoDe`):

```ts
/** Suma en centavos de lo vinculado a empleados (0 si no hay vínculos). */
export function montoVinculadoCentavos(mov: MovimientoConRelaciones): number {
  return (mov.vinculosEmpleados ?? []).reduce((acc, v) => acc + Math.round(Number(v.monto) * 100), 0);
}
```

En `resumirMovimientos`, reemplazar el uso directo de `totalFirmadoDe`:

```ts
    const firmadoBruto = totalFirmadoDe(mov);
    if (firmadoBruto == null) continue;
    // Sin doble conteo: la porción vinculada a empleados sale del libro general
    // y entra por resumirCostosPersonal según la distribución del empleado.
    const vinculado = montoVinculadoCentavos(mov);
    const firmado = firmadoBruto < 0
      ? Math.min(firmadoBruto + vinculado, 0)
      : Math.max(firmadoBruto - vinculado, 0);
```

(el resto de la función sigue igual, usando `firmado`).

- [ ] **Step 5: Correr los tests y la suite entera**

Run: `npx vitest run tests/empleados-costos.test.ts && npm test`
Expected: PASS los nuevos; `movimientos-libro.test.ts` y el resto siguen verdes (el campo nuevo es opcional).

- [ ] **Step 6: Commit**

```bash
git add lib/empleados/costos.ts lib/movimientos/query.ts tests/empleados-costos.test.ts
git commit -m "feat(empleados): resumen de costos de personal sin doble conteo con el libro"
```

---

### Task 8: Servicio de empleados (confirmar, anular, ficha, vincular)

**Files:**
- Create: `lib/empleados/service.ts`
- Test: `tests/empleados-vinculos.test.ts`

**Interfaces:**
- Consumes: `EmpresaContext` (`lib/empresa/require-empresa`), `validarDistribucion`, `writeAudit`, `DomainError`, `resumirCostosPersonal` (no directamente, pero comparte tipos de línea).
- Produces (todas reciben `ctx: EmpresaContext` y usan `ctx.db`):
  - `validarMontoVinculo(totalCentavos: number, existentesCentavos: number, nuevoCentavos: number): void` — pura, exportada para test
  - `confirmarRecibo(ctx, reciboId: string, cambios: { lineas?: LineaDistribucion[]; totales?: Partial<TotalesRecibo> }): Promise<void>`
  - `anularRecibo(ctx, reciboId: string, nota: string): Promise<void>`
  - `guardarFichaEmpleado(ctx, empleadoId: string, datos: { nombre: string; legajo?: string | null; categoria?: string | null; sector?: string | null; fechaEgreso?: string | null; activo: boolean }): Promise<void>`
  - `guardarDistribucionEmpleado(ctx, empleadoId: string, lineas: LineaDistribucion[]): Promise<void>`
  - `vincularMovimiento(ctx, params: { movimientoId: string; empleadoId: string; monto: number }): Promise<void>`
  - `desvincularMovimiento(ctx, params: { movimientoId: string; empleadoId: string }): Promise<void>`

- [ ] **Step 1: Escribir el test de la guarda pura que va a fallar**

`tests/empleados-vinculos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validarMontoVinculo } from '@/lib/empleados/service';

describe('validarMontoVinculo', () => {
  it('acepta un vínculo que entra en el total', () => {
    expect(() => validarMontoVinculo(100_000, 0, 30_000)).not.toThrow();
    expect(() => validarMontoVinculo(100_000, 70_000, 30_000)).not.toThrow(); // cubre justo el total
  });

  it('rechaza monto no positivo', () => {
    expect(() => validarMontoVinculo(100_000, 0, 0)).toThrow(/mayor a 0/);
    expect(() => validarMontoVinculo(100_000, 0, -5)).toThrow(/mayor a 0/);
  });

  it('rechaza cuando la suma de vínculos supera el total del movimiento', () => {
    expect(() => validarMontoVinculo(100_000, 80_000, 30_000)).toThrow(/supera/);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/empleados-vinculos.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el servicio**

`lib/empleados/service.ts`:

```ts
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { validarDistribucion, type LineaDistribucion } from '@/lib/movimientos/distribucion';
import type { TotalesRecibo } from './aritmetica';

// Acciones de usuario sobre empleados y recibos. Todas asumen que el caller ya
// pasó por requireEmpresa(slug, 'ADMINISTRADOR'). Un período CERRADO congela
// recibos y vínculos (misma regla que movimientos).

export function validarMontoVinculo(totalCentavos: number, existentesCentavos: number, nuevoCentavos: number): void {
  if (nuevoCentavos <= 0) throw new DomainError('El monto vinculado debe ser mayor a 0.');
  if (existentesCentavos + nuevoCentavos > totalCentavos) {
    throw new DomainError('La suma de los montos vinculados supera el total del comprobante.');
  }
}

async function reciboEditable(ctx: EmpresaContext, reciboId: string) {
  const recibo = await ctx.db.reciboSueldo.findFirst({ where: { id: reciboId }, include: { periodo: true, empleado: { include: { distribucion: true } } } });
  if (!recibo) throw new DomainError('Recibo inexistente.');
  if (recibo.periodo.estado === 'CERRADO') throw new DomainError('El período del recibo está cerrado.');
  return recibo;
}

export async function confirmarRecibo(
  ctx: EmpresaContext,
  reciboId: string,
  cambios: { lineas?: LineaDistribucion[]; totales?: Partial<TotalesRecibo> },
): Promise<void> {
  const recibo = await reciboEditable(ctx, reciboId);
  if (recibo.estado !== 'PENDIENTE_REVISION') throw new DomainError('Sólo se confirma un recibo pendiente de revisión.');

  // Distribución efectiva: la del form, o la copia de la ficha.
  const lineas = cambios.lineas?.length
    ? cambios.lineas
    : recibo.empleado.distribucion.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
  validarDistribucion(lineas);

  const t = cambios.totales ?? {};
  if ((t.costoTotalEmpleador ?? (recibo.costoTotalEmpleador != null ? Number(recibo.costoTotalEmpleador) : null)) == null) {
    throw new DomainError('El recibo necesita un costo total empleador para confirmarse.');
  }

  await ctx.db.reciboSueldo.update({
    where: { id: recibo.id },
    data: {
      estado: 'CONFIRMADO',
      confirmadoAt: new Date(),
      camposRevisar: {} as never,
      nota: null,
      ...(t.brutoRemunerativo !== undefined ? { brutoRemunerativo: t.brutoRemunerativo } : {}),
      ...(t.noRemunerativo !== undefined ? { noRemunerativo: t.noRemunerativo } : {}),
      ...(t.retenciones !== undefined ? { retenciones: t.retenciones } : {}),
      ...(t.sueldoNeto !== undefined ? { sueldoNeto: t.sueldoNeto } : {}),
      ...(t.contribucionesEmpleador !== undefined ? { contribucionesEmpleador: t.contribucionesEmpleador } : {}),
      ...(t.costoTotalEmpleador !== undefined ? { costoTotalEmpleador: t.costoTotalEmpleador } : {}),
    },
  });
  await prisma.reciboDistribucionLinea.deleteMany({ where: { reciboId: recibo.id } });
  await prisma.reciboDistribucionLinea.createMany({
    data: lineas.map((l) => ({
      reciboId: recibo.id,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: 'CONFIRMAR',
    antes: { estado: recibo.estado },
    despues: { estado: 'CONFIRMADO', lineas: lineas.length, totalesEditados: Object.keys(t) },
  });
}

export async function anularRecibo(ctx: EmpresaContext, reciboId: string, nota: string): Promise<void> {
  const recibo = await reciboEditable(ctx, reciboId);
  if (recibo.estado === 'ANULADO') throw new DomainError('El recibo ya está anulado.');
  await ctx.db.reciboSueldo.update({ where: { id: recibo.id }, data: { estado: 'ANULADO', nota: nota || 'Anulado manualmente' } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'ReciboSueldo',
    entidadId: recibo.id,
    accion: 'ANULAR',
    antes: { estado: recibo.estado },
    despues: { estado: 'ANULADO', nota },
  });
}

export async function guardarFichaEmpleado(
  ctx: EmpresaContext,
  empleadoId: string,
  datos: { nombre: string; legajo?: string | null; categoria?: string | null; sector?: string | null; fechaEgreso?: string | null; activo: boolean },
): Promise<void> {
  const empleado = await ctx.db.empleado.findFirst({ where: { id: empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');
  if (!datos.nombre.trim()) throw new DomainError('El nombre no puede quedar vacío.');
  await ctx.db.empleado.update({
    where: { id: empleadoId },
    data: {
      nombre: datos.nombre.trim(),
      legajo: datos.legajo || null,
      categoria: datos.categoria || null,
      sector: datos.sector || null,
      fechaEgreso: datos.fechaEgreso ? new Date(`${datos.fechaEgreso}T00:00:00Z`) : null,
      activo: datos.activo,
    },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: empleadoId,
    accion: 'EDITAR',
    antes: { nombre: empleado.nombre, activo: empleado.activo },
    despues: datos,
  });
}

export async function guardarDistribucionEmpleado(ctx: EmpresaContext, empleadoId: string, lineas: LineaDistribucion[]): Promise<void> {
  const empleado = await ctx.db.empleado.findFirst({ where: { id: empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');
  validarDistribucion(lineas);
  await prisma.empleadoDistribucionLinea.deleteMany({ where: { empleadoId } });
  await prisma.empleadoDistribucionLinea.createMany({
    data: lineas.map((l) => ({
      empleadoId,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empleado',
    entidadId: empleadoId,
    accion: 'DISTRIBUCION',
    despues: { lineas: lineas.map((l) => ({ cc: l.centroCostoId, pct: l.porcentaje })) },
  });
}

export async function vincularMovimiento(
  ctx: EmpresaContext,
  params: { movimientoId: string; empleadoId: string; monto: number },
): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId }, include: { periodo: true, vinculosEmpleados: true } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.total == null) throw new DomainError('El movimiento no tiene total: no se puede vincular.');
  if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento está cerrado.');
  const empleado = await ctx.db.empleado.findFirst({ where: { id: params.empleadoId } });
  if (!empleado) throw new DomainError('Empleado inexistente.');

  const nuevoCentavos = Math.round(params.monto * 100);
  const existentes = mov.vinculosEmpleados
    .filter((v) => v.empleadoId !== params.empleadoId)
    .reduce((acc, v) => acc + Math.round(Number(v.monto) * 100), 0);
  validarMontoVinculo(Math.round(Number(mov.total) * 100), existentes, nuevoCentavos);

  // El cliente scoped no soporta upsert: findFirst + create/update.
  const previo = await ctx.db.movimientoEmpleado.findFirst({ where: { movimientoId: params.movimientoId, empleadoId: params.empleadoId } });
  if (previo) {
    await ctx.db.movimientoEmpleado.update({ where: { id: previo.id }, data: { monto: params.monto } });
  } else {
    await prisma.movimientoEmpleado.create({ data: { movimientoId: params.movimientoId, empleadoId: params.empleadoId, monto: params.monto } });
  }
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: params.movimientoId,
    accion: 'VINCULAR_EMPLEADO',
    despues: { empleado: empleado.nombre, monto: params.monto },
  });
}

export async function desvincularMovimiento(ctx: EmpresaContext, params: { movimientoId: string; empleadoId: string }): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id: params.movimientoId }, include: { periodo: true } });
  if (!mov) throw new DomainError('Movimiento inexistente.');
  if (mov.periodo?.estado === 'CERRADO') throw new DomainError('El período del movimiento está cerrado.');
  const vinculo = await ctx.db.movimientoEmpleado.findFirst({ where: { movimientoId: params.movimientoId, empleadoId: params.empleadoId } });
  if (!vinculo) throw new DomainError('El vínculo no existe.');
  await ctx.db.movimientoEmpleado.delete({ where: { id: vinculo.id } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: params.movimientoId,
    accion: 'DESVINCULAR_EMPLEADO',
    despues: { empleadoId: params.empleadoId },
  });
}
```

Nota: `Movimiento` necesita la relación `periodo` — ya existe (`periodoId` + relación con `Periodo`); verificar el nombre exacto del campo de relación en el schema antes de usar `include: { periodo: true }` (si la relación no existe con ese nombre, resolver el período con `findFirst` sobre `Periodo` por `periodoId`).

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/empleados-vinculos.test.ts && npx tsc --noEmit`
Expected: PASS + typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/empleados/service.ts tests/empleados-vinculos.test.ts
git commit -m "feat(empleados): servicio de confirmación, ficha, distribución y vínculos"
```

---

### Task 9: Sección Empleados — actions, listado, carga y pendientes

**Files:**
- Create: `app/(app)/[empresaSlug]/empleados/actions.ts`
- Create: `app/(app)/[empresaSlug]/empleados/page.tsx`
- Create: `components/recibos-upload.tsx`
- Modify: `app/(app)/[empresaSlug]/layout.tsx:31-88` (entrada de sidebar, sólo admin)

**Interfaces:**
- Consumes: `ingestarRecibos` (Task 6), servicio (Task 8), `requireEmpresa(slug, 'ADMINISTRADOR')`, `formatMoney`/`formatFecha` (`lib/format`), `MES_LABEL`/`periodoDeFecha` (`lib/periodos`).
- Produces: `subirRecibosAction(formData): Promise<{ ok: boolean; paginas?: number; error?: string }>` (la usa `components/recibos-upload.tsx`); las demás actions redirigen con `?ok=`/`?error=`.

- [ ] **Step 1: Escribir las actions**

`app/(app)/[empresaSlug]/empleados/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { ingestarRecibos } from '@/lib/empleados/ingesta';
import {
  confirmarRecibo, anularRecibo, guardarFichaEmpleado, guardarDistribucionEmpleado,
  vincularMovimiento, desvincularMovimiento,
} from '@/lib/empleados/service';
import type { TotalesRecibo } from '@/lib/empleados/aritmetica';

// Todas las actions de Empleados exigen ADMINISTRADOR: los sueldos son datos
// sensibles y esta es la primera sección con restricción por rol.

const MAX_BYTES = 15 * 1024 * 1024;

function leerLineas(formData: FormData) {
  const ccIds = formData.getAll('linea_centroCostoId').map(String);
  const cliIds = formData.getAll('linea_clienteId').map(String);
  const prIds = formData.getAll('linea_proyectoId').map(String);
  const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
  return ccIds
    .map((cc, i) => ({ centroCostoId: cc, clienteId: cliIds[i] || null, proyectoId: prIds[i] || null, porcentaje: pcts[i] }))
    .filter((l) => l.centroCostoId);
}

function numeroOpcional(formData: FormData, name: string): number | undefined {
  const v = formData.get(name);
  if (v == null || String(v).trim() === '') return undefined;
  return Number(String(v).replace(/\./g, '').replace(',', '.'));
}

function volverConError(slug: string, path: string, err: unknown): never {
  if (isDomainError(err) || isForbidden(err)) {
    redirect(`/${slug}/${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function subirRecibosAction(formData: FormData): Promise<{ ok: boolean; paginas?: number; error?: string }> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const archivo = formData.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'No se recibió el PDF.' };
    if (archivo.type !== 'application/pdf') return { ok: false, error: 'Los recibos se cargan como PDF.' };
    if (archivo.size > MAX_BYTES) return { ok: false, error: 'El PDF supera el máximo de 15 MB.' };
    const { paginas } = await ingestarRecibos({
      empresaId: ctx.empresa.id,
      usuarioId: ctx.usuario.id,
      buffer: Buffer.from(await archivo.arrayBuffer()),
      filename: archivo.name,
      mime: archivo.type,
    });
    return { ok: true, paginas };
  } catch (err) {
    if (isForbidden(err) || isDomainError(err)) return { ok: false, error: err.message };
    throw err;
  }
}

export async function confirmarReciboAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const reciboId = String(formData.get('reciboId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const totales: Partial<TotalesRecibo> = {
      brutoRemunerativo: numeroOpcional(formData, 'brutoRemunerativo'),
      noRemunerativo: numeroOpcional(formData, 'noRemunerativo'),
      retenciones: numeroOpcional(formData, 'retenciones'),
      sueldoNeto: numeroOpcional(formData, 'sueldoNeto'),
      contribucionesEmpleador: numeroOpcional(formData, 'contribucionesEmpleador'),
      costoTotalEmpleador: numeroOpcional(formData, 'costoTotalEmpleador'),
    };
    await confirmarRecibo(ctx, reciboId, { lineas: leerLineas(formData), totales });
  } catch (err) {
    volverConError(slug, `empleados/recibos/${reciboId}`, err);
  }
  redirect(`/${slug}/empleados?tab=pendientes&ok=${encodeURIComponent('Recibo confirmado')}`);
}

export async function anularReciboAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const reciboId = String(formData.get('reciboId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await anularRecibo(ctx, reciboId, String(formData.get('nota') ?? ''));
  } catch (err) {
    volverConError(slug, `empleados/recibos/${reciboId}`, err);
  }
  redirect(`/${slug}/empleados?ok=${encodeURIComponent('Recibo anulado')}`);
}

export async function guardarFichaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await guardarFichaEmpleado(ctx, empleadoId, {
      nombre: String(formData.get('nombre') ?? ''),
      legajo: String(formData.get('legajo') ?? '') || null,
      categoria: String(formData.get('categoria') ?? '') || null,
      sector: String(formData.get('sector') ?? '') || null,
      fechaEgreso: String(formData.get('fechaEgreso') ?? '') || null,
      activo: formData.get('activo') === '1',
    });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Ficha guardada')}`);
}

export async function guardarDistribucionAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await guardarDistribucionEmpleado(ctx, empleadoId, leerLineas(formData));
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Distribución guardada')}`);
}

export async function vincularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await vincularMovimiento(ctx, {
      movimientoId: String(formData.get('movimientoId')),
      empleadoId,
      monto: numeroOpcional(formData, 'monto') ?? 0,
    });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Comprobante vinculado')}`);
}

export async function desvincularAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  const empleadoId = String(formData.get('empleadoId'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    await desvincularMovimiento(ctx, { movimientoId: String(formData.get('movimientoId')), empleadoId });
  } catch (err) {
    volverConError(slug, `empleados/${empleadoId}`, err);
  }
  redirect(`/${slug}/empleados/${empleadoId}?ok=${encodeURIComponent('Vínculo eliminado')}`);
}
```

- [ ] **Step 2: Componente de carga**

`components/recibos-upload.tsx` (calco de `UploadZone` simplificado a un archivo):

```tsx
'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { subirRecibosAction } from '@/app/(app)/[empresaSlug]/empleados/actions';

export function RecibosUpload({ empresaSlug }: { empresaSlug: string }) {
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subiendo, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function enviar(file: File) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('empresaSlug', empresaSlug);
      fd.set('archivo', file);
      const r = await subirRecibosAction(fd);
      setMensaje(
        r.ok
          ? { ok: true, texto: `PDF recibido: ${r.paginas} página${r.paginas !== 1 ? 's' : ''} encoladas. El worker las está procesando.` }
          : { ok: false, texto: r.error ?? 'Error inesperado' },
      );
      router.refresh();
    });
  }

  return (
    <div>
      <button type="button" className="btn-primary" disabled={subiendo} onClick={() => inputRef.current?.click()}>
        {subiendo ? 'Subiendo…' : 'Subir recibos (PDF)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) enviar(f);
          e.target.value = '';
        }}
      />
      {mensaje && <p className={`mt-2 text-sm ${mensaje.ok ? 'text-accent-strong' : 'text-red-600'}`}>{mensaje.texto}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Página principal de Empleados**

`app/(app)/[empresaSlug]/empleados/page.tsx`:

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL, periodoDeFecha } from '@/lib/periodos';
import { formatMoney } from '@/lib/format';
import { RecibosUpload } from '@/components/recibos-upload';
import { OkBanner } from '@/components/error-banner';

// Sección Empleados (sólo ADMINISTRADOR): checklist y costo por período.
export default async function EmpleadosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { anio?: string; mes?: string; tab?: string; ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const hoy = periodoDeFecha(new Date());
  const anio = Number(searchParams.anio ?? hoy.anio);
  const mes = Number(searchParams.mes ?? hoy.mes);
  const tab = searchParams.tab === 'pendientes' ? 'pendientes' : 'periodo';

  const [empleados, recibosPeriodo, pendientes, jobsFallados, jobsEnCola] = await Promise.all([
    ctx.db.empleado.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.reciboSueldo.findMany({
      where: { periodo: { anio, mes }, estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] } },
      include: { empleado: true },
    }),
    ctx.db.reciboSueldo.findMany({
      where: { estado: 'PENDIENTE_REVISION' },
      include: { empleado: true, periodo: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.job.findMany({
      where: { tipo: 'EXTRACCION_RECIBO', empresaId: ctx.empresa.id, estado: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.job.count({
      where: { tipo: 'EXTRACCION_RECIBO', empresaId: ctx.empresa.id, estado: { in: ['queued', 'processing'] } },
    }),
  ]);

  // Vinculados del período: monto por empleado de movimientos ASIGNADOS del mes.
  const vinculos = await ctx.db.movimientoEmpleado.findMany({
    where: { movimiento: { estado: 'ASIGNADO', periodo: { anio, mes } } },
  });
  const vinculadoPorEmpleado = new Map<string, number>();
  for (const v of vinculos) {
    vinculadoPorEmpleado.set(v.empleadoId, (vinculadoPorEmpleado.get(v.empleadoId) ?? 0) + Number(v.monto));
  }
  const recibosPorEmpleado = new Map<string, { confirmado: number; pendiente: boolean }>();
  for (const r of recibosPeriodo) {
    const acc = recibosPorEmpleado.get(r.empleadoId) ?? { confirmado: 0, pendiente: false };
    if (r.estado === 'CONFIRMADO') acc.confirmado += Number(r.costoTotalEmpleador ?? 0);
    else acc.pendiente = true;
    recibosPorEmpleado.set(r.empleadoId, acc);
  }
  const costoTotal =
    [...recibosPorEmpleado.values()].reduce((a, r) => a + r.confirmado, 0) +
    [...vinculadoPorEmpleado.values()].reduce((a, v) => a + v, 0);

  const mesAnterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const mesSiguiente = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
  const base = `/${params.empresaSlug}/empleados`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Empleados</h1>
          <p className="text-xs text-slate-500">Costo de personal por período. Sólo administradores ven esta sección.</p>
        </div>
        <RecibosUpload empresaSlug={params.empresaSlug} />
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
      {jobsEnCola > 0 && (
        <p className="text-sm text-amber-600">⏳ {jobsEnCola} página{jobsEnCola !== 1 ? 's' : ''} de recibos en procesamiento… (actualizá para ver el avance)</p>
      )}
      {jobsFallados.length > 0 && (
        <div className="card p-3 border-red-200">
          <p className="text-sm font-medium text-red-700">Páginas con error de procesamiento</p>
          {jobsFallados.map((j) => (
            <p key={j.id} className="text-xs text-red-600">
              Página {(j.payload as { pagina?: number }).pagina ?? '?'}: {j.error}
            </p>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-500">Costo total de personal · {MES_LABEL[mes - 1]} {anio}</p>
          <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoney(costoTotal)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500">Empleados con recibo</p>
          <p className="text-xl font-semibold tabular-nums">{recibosPorEmpleado.size} / {empleados.length}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500">Pendientes de revisión (todos los períodos)</p>
          <p className="text-xl font-semibold tabular-nums">{pendientes.length}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`${base}?anio=${mesAnterior.anio}&mes=${mesAnterior.mes}`} className="btn-secondary text-xs">←</Link>
        <span className="text-sm font-medium">{MES_LABEL[mes - 1]} {anio}</span>
        <Link href={`${base}?anio=${mesSiguiente.anio}&mes=${mesSiguiente.mes}`} className="btn-secondary text-xs">→</Link>
        <span className="mx-2 text-slate-300">|</span>
        <Link href={`${base}?anio=${anio}&mes=${mes}`} className={`text-sm ${tab === 'periodo' ? 'font-semibold underline' : 'text-slate-500'}`}>Período</Link>
        <Link href={`${base}?tab=pendientes`} className={`text-sm ${tab === 'pendientes' ? 'font-semibold underline' : 'text-slate-500'}`}>
          Pendientes {pendientes.length > 0 && `(${pendientes.length})`}
        </Link>
      </div>

      {tab === 'periodo' ? (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Empleado</th><th>Categoría / sector</th><th className="text-right">Recibos</th><th className="text-right">Vinculados</th><th className="text-right">Costo total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {empleados.map((e) => {
                const r = recibosPorEmpleado.get(e.id);
                const vinc = vinculadoPorEmpleado.get(e.id) ?? 0;
                const total = (r?.confirmado ?? 0) + vinc;
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td><Link href={`${base}/${e.id}`} className="font-medium hover:underline">{e.nombre}</Link></td>
                    <td className="text-xs text-slate-500">{[e.categoria, e.sector].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="num">{r?.confirmado ? formatMoney(r.confirmado) : '—'}</td>
                    <td className="num">{vinc ? formatMoney(vinc) : '—'}</td>
                    <td className="num font-medium">{total ? formatMoney(total) : '—'}</td>
                    <td className="text-xs">{r?.pendiente ? '⏳ pendiente' : r?.confirmado ? '✔ confirmado' : '— sin recibo'}</td>
                  </tr>
                );
              })}
              {empleados.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 py-8">Sin empleados: subí el PDF de recibos para darlos de alta.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Empleado</th><th>Período</th><th>Tipo</th><th className="text-right">Costo total</th><th>Motivos</th><th /></tr>
            </thead>
            <tbody>
              {pendientes.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="font-medium">{r.empleado.nombre}</td>
                  <td>{MES_LABEL[r.periodo.mes - 1]} {r.periodo.anio}</td>
                  <td className="text-xs">{r.tipo}</td>
                  <td className="num">{r.costoTotalEmpleador ? formatMoney(Number(r.costoTotalEmpleador)) : '—'}</td>
                  <td className="text-xs text-amber-700">
                    {r.nota ? `${r.nota}. ` : ''}
                    {Object.values((r.camposRevisar as Record<string, string> | null) ?? {}).join(' · ')}
                  </td>
                  <td><Link href={`${base}/recibos/${r.id}`} className="btn-secondary text-xs">Revisar</Link></td>
                </tr>
              ))}
              {pendientes.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-400 py-8">Nada pendiente de revisión.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Entrada en el sidebar (sólo admin)**

En `app/(app)/[empresaSlug]/layout.tsx`, dentro del array `secciones`, después del bloque `'Registros'`:

```tsx
    ...(esAdmin
      ? [
          {
            titulo: 'Personal',
            items: [{ href: `${base}/empleados`, label: 'Empleados', icono: 'headcount' }],
          },
        ]
      : []),
```

(El icono `headcount` ya existe en `components/iconos.tsx`; verificar el nombre exacto con `grep headcount components/iconos.tsx` y usar el que esté registrado.)

- [ ] **Step 5: Verificar typecheck y levantar la app**

Run: `npx tsc --noEmit && npm run build`
Expected: limpio. La página compila; la carga se prueba e2e en Task 12.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/\[empresaSlug\]/empleados/actions.ts app/\(app\)/\[empresaSlug\]/empleados/page.tsx components/recibos-upload.tsx app/\(app\)/\[empresaSlug\]/layout.tsx
git commit -m "feat(empleados): sección Empleados con carga de recibos y cola de pendientes"
```

---

### Task 10: Revisión de recibo y ficha del empleado

**Files:**
- Create: `app/(app)/[empresaSlug]/empleados/recibos/[id]/page.tsx`
- Create: `app/(app)/[empresaSlug]/empleados/[id]/page.tsx`

**Interfaces:**
- Consumes: actions de Task 9, `DocViewer` (`components/doc-viewer.tsx`: `{ url, mime, nombre }`), `DistribucionEditor` (`components/distribucion-editor.tsx`), `MES_LABEL`, `formatMoney`, `formatFecha`, `formatearCuit` (`lib/checks/cuit`).
- Nota de ruta: `empleados/recibos/[id]` es segmento estático `recibos` + dinámico — no colisiona con `empleados/[id]` (Next prioriza el estático).

- [ ] **Step 1: Página de revisión del recibo**

`app/(app)/[empresaSlug]/empleados/recibos/[id]/page.tsx`. Estructura (dos columnas como Validación): a la izquierda `DocViewer` con `url={`/api/archivos/${recibo.archivoKey}#page=${recibo.pagina}`}`; a la derecha el form que postea a `confirmarReciboAction`:

```tsx
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL } from '@/lib/periodos';
import { formatearCuit } from '@/lib/checks/cuit';
import { DocViewer } from '@/components/doc-viewer';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { confirmarReciboAction, anularReciboAction } from '../../actions';

export default async function ReciboPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const recibo = await ctx.db.reciboSueldo.findFirst({
    where: { id: params.id },
    include: { empleado: { include: { distribucion: true } }, periodo: true, lineas: true },
  });
  if (!recibo) notFound();

  const [centros, clientes, proyectos] = await Promise.all([
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
  ]);

  const revisar = (recibo.camposRevisar as Record<string, string> | null) ?? {};
  const conceptos = (recibo.conceptos as { concepto: string; unidad: string | null; importe: number; naturaleza: string }[] | null) ?? [];
  // Distribución inicial: la del recibo si ya tiene, si no la de la ficha.
  const lineasIniciales = (recibo.lineas.length ? recibo.lineas : recibo.empleado.distribucion).map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId ?? '',
    proyectoId: l.proyectoId ?? '',
    porcentaje: String(Number(l.porcentaje)),
  }));

  const totales: { name: string; label: string; valor: unknown }[] = [
    { name: 'brutoRemunerativo', label: 'Bruto remunerativo', valor: recibo.brutoRemunerativo },
    { name: 'noRemunerativo', label: 'No remunerativo', valor: recibo.noRemunerativo },
    { name: 'retenciones', label: 'Retenciones', valor: recibo.retenciones },
    { name: 'sueldoNeto', label: 'Sueldo neto', valor: recibo.sueldoNeto },
    { name: 'contribucionesEmpleador', label: 'Contribuciones empleador', valor: recibo.contribucionesEmpleador },
    { name: 'costoTotalEmpleador', label: 'COSTO TOTAL EMPLEADOR', valor: recibo.costoTotalEmpleador },
  ];

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-2 min-h-[70vh]">
        {recibo.archivoKey ? (
          <DocViewer url={`/api/archivos/${recibo.archivoKey}#page=${recibo.pagina ?? 1}`} mime={recibo.archivoMime ?? 'application/pdf'} nombre={recibo.archivoNombre ?? 'recibo'} />
        ) : (
          <p className="text-sm text-slate-400 p-4">Sin archivo adjunto</p>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">
            {recibo.empleado.nombre} · {recibo.tipo} · {MES_LABEL[recibo.periodo.mes - 1]} {recibo.periodo.anio}
          </h1>
          <p className="text-xs text-slate-500">CUIL {formatearCuit(recibo.empleado.cuil)} · página {recibo.pagina} de {recibo.archivoNombre} · estado {recibo.estado}</p>
        </div>
        {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
        {recibo.nota && <p className="text-sm text-amber-700">{recibo.nota}</p>}

        <form action={confirmarReciboAction} className="space-y-4">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="reciboId" value={recibo.id} />

          <div className="card p-3 grid grid-cols-2 gap-2">
            {totales.map((t) => (
              <div key={t.name}>
                <label className="label">{t.label}</label>
                <input name={t.name} defaultValue={t.valor != null ? String(Number(t.valor)) : ''} className={`input text-sm ${revisar[t.name] ? 'border-amber-400' : ''}`} />
                {revisar[t.name] && <p className="text-[11px] text-amber-700 mt-0.5">{revisar[t.name]}</p>}
              </div>
            ))}
            {revisar.empleado && <p className="col-span-2 text-[11px] text-amber-700">{revisar.empleado}</p>}
          </div>

          {conceptos.length > 0 && (
            <div className="card p-3 overflow-x-auto">
              <p className="text-xs text-slate-500 mb-1">Conceptos extraídos</p>
              <table className="table-base text-xs">
                <tbody>
                  {conceptos.map((c, i) => (
                    <tr key={i}>
                      <td>{c.concepto}</td>
                      <td className="text-slate-400">{c.unidad ?? ''}</td>
                      <td className="text-slate-400">{c.naturaleza.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="num">{c.importe.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card p-3">
            <p className="text-xs text-slate-500 mb-2">Distribución (pre-cargada desde la ficha; el ajuste vale sólo para este recibo)</p>
            <DistribucionEditor
              centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
              clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
              proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre }))}
              iniciales={lineasIniciales}
            />
          </div>

          {recibo.estado === 'PENDIENTE_REVISION' && recibo.periodo.estado === 'ABIERTO' && (
            <button className="btn-primary">Confirmar recibo</button>
          )}
          {recibo.periodo.estado === 'CERRADO' && (
            <p className="text-sm text-amber-700">El período está cerrado: el recibo no se puede modificar.</p>
          )}
        </form>

        {recibo.estado !== 'ANULADO' && recibo.periodo.estado === 'ABIERTO' && (
          <form action={anularReciboAction} className="flex gap-2 items-end">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="reciboId" value={recibo.id} />
            <div className="grow">
              <label className="label">Motivo de anulación</label>
              <input name="nota" className="input text-sm" placeholder="p.ej. recibo rectificado" />
            </div>
            <button className="btn-secondary">Anular</button>
          </form>
        )}
      </div>
    </div>
  );
}
```

**Nota para el implementador:** antes de escribir el JSX, leer `components/distribucion-editor.tsx` y `app/(app)/[empresaSlug]/asignacion/[id]/page.tsx` para copiar EXACTAMENTE las props reales del `DistribucionEditor` (nombres `centros/clientes/proyectos/iniciales` a confirmar) y el patrón de inputs `linea_*` que espera `leerLineas`. Ajustar el snippet de arriba a lo que exista — el contrato con las actions es que los inputs se llamen `linea_centroCostoId`, `linea_clienteId`, `linea_proyectoId`, `linea_porcentaje`.

- [ ] **Step 2: Ficha del empleado**

`app/(app)/[empresaSlug]/empleados/[id]/page.tsx` — cuatro bloques: ficha editable (form → `guardarFichaAction`), distribución por defecto (`DistribucionEditor` → `guardarDistribucionAction`), historial por período, vínculos:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { MES_LABEL } from '@/lib/periodos';
import { formatMoney, formatFecha } from '@/lib/format';
import { formatearCuit } from '@/lib/checks/cuit';
import { DistribucionEditor } from '@/components/distribucion-editor';
import { OkBanner } from '@/components/error-banner';
import { guardarFichaAction, guardarDistribucionAction, vincularAction, desvincularAction } from '../actions';

export default async function EmpleadoPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; id: string };
  searchParams: { ok?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const empleado = await ctx.db.empleado.findFirst({
    where: { id: params.id },
    include: {
      distribucion: true,
      recibos: { include: { periodo: true }, orderBy: { createdAt: 'desc' } },
      vinculos: { include: { movimiento: { include: { contraparte: true, periodo: true } } } },
    },
  });
  if (!empleado) notFound();

  const [centros, clientes, proyectos, movimientosVinculables] = await Promise.all([
    ctx.db.centroCosto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } }),
    ctx.db.movimiento.findMany({
      where: { estado: 'ASIGNADO', total: { not: null } },
      include: { contraparte: true },
      orderBy: [{ fechaDevengamiento: 'desc' }],
      take: 100,
    }),
  ]);

  // Historial: recibos confirmados + vinculados, agrupados por período.
  const porPeriodo = new Map<string, { anio: number; mes: number; mensual: number; sac: number; otros: number; vinculado: number }>();
  const bucket = (anio: number, mes: number) => {
    const k = `${anio}-${mes}`;
    if (!porPeriodo.has(k)) porPeriodo.set(k, { anio, mes, mensual: 0, sac: 0, otros: 0, vinculado: 0 });
    return porPeriodo.get(k)!;
  };
  for (const r of empleado.recibos) {
    if (r.estado !== 'CONFIRMADO' || r.costoTotalEmpleador == null) continue;
    const b = bucket(r.periodo.anio, r.periodo.mes);
    const monto = Number(r.costoTotalEmpleador);
    if (r.tipo === 'MENSUAL') b.mensual += monto;
    else if (r.tipo === 'SAC') b.sac += monto;
    else b.otros += monto;
  }
  for (const v of empleado.vinculos) {
    if (v.movimiento.estado !== 'ASIGNADO' || !v.movimiento.periodo) continue;
    bucket(v.movimiento.periodo.anio, v.movimiento.periodo.mes).vinculado += Number(v.monto);
  }
  const historial = [...porPeriodo.values()].sort((a, b) => b.anio - a.anio || b.mes - a.mes);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{empleado.nombre}</h1>
        <p className="text-xs text-slate-500">
          CUIL {formatearCuit(empleado.cuil)} · legajo {empleado.legajo ?? '—'} · ingreso {formatFecha(empleado.fechaIngreso)}
        </p>
      </div>
      <OkBanner mensaje={searchParams.ok} />
      {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}

      <div className="grid lg:grid-cols-2 gap-4">
        <form action={guardarFichaAction} className="card p-3 space-y-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <p className="text-sm font-medium">Ficha</p>
          <div><label className="label">Nombre</label><input name="nombre" defaultValue={empleado.nombre} className="input text-sm" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Legajo</label><input name="legajo" defaultValue={empleado.legajo ?? ''} className="input text-sm" /></div>
            <div><label className="label">Categoría</label><input name="categoria" defaultValue={empleado.categoria ?? ''} className="input text-sm" /></div>
            <div><label className="label">Sector</label><input name="sector" defaultValue={empleado.sector ?? ''} className="input text-sm" /></div>
            <div><label className="label">Fecha de egreso</label><input type="date" name="fechaEgreso" defaultValue={empleado.fechaEgreso?.toISOString().slice(0, 10) ?? ''} className="input text-sm" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="activo" value="1" defaultChecked={empleado.activo} /> Activo</label>
          <button className="btn-primary text-sm">Guardar ficha</button>
        </form>

        <form action={guardarDistribucionAction} className="card p-3 space-y-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <p className="text-sm font-medium">Distribución por defecto</p>
          <p className="text-xs text-slate-500">Cada recibo nuevo la hereda al confirmarse. Cambiarla no toca recibos ya confirmados.</p>
          <DistribucionEditor
            centros={centros.map((c) => ({ id: c.id, nombre: c.nombre }))}
            clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
            proyectos={proyectos.map((p) => ({ id: p.id, nombre: p.nombre }))}
            iniciales={empleado.distribucion.map((l) => ({
              centroCostoId: l.centroCostoId,
              clienteId: l.clienteId ?? '',
              proyectoId: l.proyectoId ?? '',
              porcentaje: String(Number(l.porcentaje)),
            }))}
          />
          <button className="btn-primary text-sm">Guardar distribución</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-sm font-medium p-3 pb-0">Costo por período</p>
        <table className="table-base">
          <thead><tr><th>Período</th><th className="text-right">Mensual</th><th className="text-right">SAC</th><th className="text-right">Otros recibos</th><th className="text-right">Vinculados</th><th className="text-right">Costo total</th></tr></thead>
          <tbody>
            {historial.map((h) => (
              <tr key={`${h.anio}-${h.mes}`}>
                <td>{MES_LABEL[h.mes - 1]} {h.anio}</td>
                <td className="num">{h.mensual ? formatMoney(h.mensual) : '—'}</td>
                <td className="num">{h.sac ? formatMoney(h.sac) : '—'}</td>
                <td className="num">{h.otros ? formatMoney(h.otros) : '—'}</td>
                <td className="num">{h.vinculado ? formatMoney(h.vinculado) : '—'}</td>
                <td className="num font-medium">{formatMoney(h.mensual + h.sac + h.otros + h.vinculado)}</td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-6">Sin costos registrados todavía.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <p className="text-sm font-medium p-3 pb-0">Recibos</p>
        <table className="table-base">
          <thead><tr><th>Período</th><th>Tipo</th><th>Estado</th><th className="text-right">Costo total</th><th /></tr></thead>
          <tbody>
            {empleado.recibos.map((r) => (
              <tr key={r.id}>
                <td>{MES_LABEL[r.periodo.mes - 1]} {r.periodo.anio}</td>
                <td className="text-xs">{r.tipo}</td>
                <td className="text-xs">{r.estado}{r.nota ? ` · ${r.nota}` : ''}</td>
                <td className="num">{r.costoTotalEmpleador ? formatMoney(Number(r.costoTotalEmpleador)) : '—'}</td>
                <td><Link href={`/${params.empresaSlug}/empleados/recibos/${r.id}`} className="btn-secondary text-xs">Ver</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-3 space-y-3">
        <p className="text-sm font-medium">Comprobantes vinculados</p>
        <p className="text-xs text-slate-500">La porción vinculada computa como costo de este empleado (con su distribución) y se descuenta del gasto general del libro.</p>
        {empleado.vinculos.map((v) => (
          <form key={v.id} action={desvincularAction} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <input type="hidden" name="empleadoId" value={empleado.id} />
            <input type="hidden" name="movimientoId" value={v.movimientoId} />
            <span className="grow">
              {v.movimiento.contraparte?.razonSocial ?? v.movimiento.descripcion ?? v.movimientoId} · {formatFecha(v.movimiento.fechaDevengamiento)} · total {formatMoney(Number(v.movimiento.total ?? 0))}
            </span>
            <span className="num font-medium">{formatMoney(Number(v.monto))}</span>
            <button className="btn-secondary text-xs" disabled={v.movimiento.periodo?.estado === 'CERRADO'}>Quitar</button>
          </form>
        ))}
        <form action={vincularAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <input type="hidden" name="empleadoId" value={empleado.id} />
          <div className="grow min-w-64">
            <label className="label">Comprobante (asignados recientes)</label>
            <select name="movimientoId" className="input text-sm">
              {movimientosVinculables.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.contraparte?.razonSocial ?? m.descripcion ?? m.id} · {m.fechaDevengamiento?.toISOString().slice(0, 10) ?? ''} · ${Number(m.total).toLocaleString('es-AR')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Monto vinculado ($)</label>
            <input name="monto" className="input text-sm w-36" placeholder="0,00" />
          </div>
          <button className="btn-primary text-sm">Vincular</button>
        </form>
      </div>
    </div>
  );
}
```

(Misma nota que el Step 1: confirmar las props reales de `DistribucionEditor` contra el código antes de escribir.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: limpio.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/\[empresaSlug\]/empleados/
git commit -m "feat(empleados): revisión de recibo y ficha con historial y vínculos"
```

---

### Task 11: Bloque "Costos de personal" en Movimientos + advertencia de cierre

**Files:**
- Modify: `app/(app)/[empresaSlug]/movimientos/page.tsx` (include de vínculos + card del bloque + badge)
- Modify: `app/(app)/[empresaSlug]/movimientos/export/route.ts` (línea agregada en CSV)
- Modify: `app/(app)/[empresaSlug]/periodos/page.tsx` (advertencia de recibos pendientes)

**Interfaces:**
- Consumes: `resumirCostosPersonal` (Task 7), `montoVinculadoCentavos` (Task 7).

- [ ] **Step 1: Movimientos — datos**

En `app/(app)/[empresaSlug]/movimientos/page.tsx`:

1. Al `include` del `findMany` de movimientos agregar `vinculosEmpleados: { select: { monto: true } }` — con eso `resumirMovimientos` ya descuenta lo vinculado (Task 7).
2. Cargar el bloque de personal (después del `findMany`):

```tsx
import { resumirCostosPersonal } from '@/lib/empleados/costos';
// ...
  // Costos de personal del rango: recibos CONFIRMADOS cuyos períodos caen en
  // [desde, hasta] (por mes) + porciones vinculadas de los movimientos listados.
  const recibosConfirmados = await ctx.db.reciboSueldo.findMany({
    where: { estado: 'CONFIRMADO' },
    include: { periodo: true, lineas: true },
  });
  const dentroDelRango = (anio: number, mes: number) => {
    const clave = anio * 100 + mes;
    const desde = searchParams.desde ? Number(searchParams.desde.slice(0, 7).replace('-', '')) : null;
    const hasta = searchParams.hasta ? Number(searchParams.hasta.slice(0, 7).replace('-', '')) : null;
    return (desde == null || clave >= desde) && (hasta == null || clave <= hasta);
  };
  const vinculosDeSeleccion = await ctx.db.movimientoEmpleado.findMany({
    where: { movimientoId: { in: movimientos.map((m) => m.id) } },
    include: { empleado: { include: { distribucion: true } } },
  });
  const resumenPersonal = resumirCostosPersonal(
    recibosConfirmados
      .filter((r) => dentroDelRango(r.periodo.anio, r.periodo.mes))
      .map((r) => ({ costoTotalEmpleador: r.costoTotalEmpleador, lineas: r.lineas })),
    vinculosDeSeleccion.map((v) => ({ monto: v.monto, lineasEmpleado: v.empleado.distribucion })),
  );
```

3. Filtro por centro de costo/cliente: si `searchParams.centroCostoId` o `clienteId` están seteados, el bloque muestra sólo esa porción (`resumenPersonal.porCentroCosto.get(...)` / `porCliente.get(...)`) en lugar del total.

- [ ] **Step 2: Movimientos — render**

Cambiar el grid de KPIs a `sm:grid-cols-4` y agregar la card (visible para todos los roles, agregado sin detalle por empleado):

```tsx
        <div className="card p-3">
          <p className="text-xs text-slate-500">Costos de personal</p>
          <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoneyFirmado(resumenPersonal.total)}</p>
          <p className="text-[11px] text-slate-500 mt-1 space-x-2">
            {[...resumenPersonal.porCentroCosto.entries()].map(([ccId, total]) => (
              <span key={ccId} className="whitespace-nowrap">
                {centros.find((c) => c.id === ccId)?.nombre ?? '?'}: <span className="tabular-nums">{formatMoneyFirmado(total)}</span>
              </span>
            ))}
          </p>
        </div>
```

En la card "Resultado", mostrar además `Resultado con personal: {formatMoneyFirmado(resumen.resultado + resumenPersonal.total)}` como línea secundaria. En la fila de la tabla, si `m.vinculosEmpleados?.length`, agregar tras la descripción: `<span className="text-[10px] text-slate-400 ml-1">· vinculado a empleados</span>`.

- [ ] **Step 3: Export CSV**

Leer `app/(app)/[empresaSlug]/movimientos/export/route.ts` y replicar el cálculo del bloque personal (mismo código del Step 1); agregar al final del CSV una única línea agregada, con las columnas que el CSV ya tenga (rellenar las no aplicables con vacío): descripción `"Costos de personal (recibos + vinculados)"` e importe `resumenPersonal.total / 100`. Sin detalle por empleado.

- [ ] **Step 4: Advertencia al cerrar período**

En `app/(app)/[empresaSlug]/periodos/page.tsx`: junto a la lista de períodos, contar los recibos pendientes por período:

```tsx
  const pendientesPorPeriodo = await ctx.db.reciboSueldo.groupBy({
    by: ['periodoId'],
    where: { estado: 'PENDIENTE_REVISION' },
    _count: { id: true },
  });
```

Y en la fila del período (donde está el botón de cerrar), si tiene pendientes:

```tsx
  {pend > 0 && (
    <p className="text-[11px] text-amber-700">
      ⚠ {pend} recibo{pend !== 1 ? 's' : ''} de sueldo pendiente{pend !== 1 ? 's' : ''} de revisión: se pueden confirmar después sólo reabriendo el período.
    </p>
  )}
```

(donde `pend = pendientesPorPeriodo.find((p) => p.periodoId === periodo.id)?._count.id ?? 0`; ubicar el punto exacto leyendo la página — no bloquea el cierre, sólo advierte).

- [ ] **Step 5: Verificar suite + typecheck + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde/limpio.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/\[empresaSlug\]/movimientos/ app/\(app\)/\[empresaSlug\]/periodos/page.tsx
git commit -m "feat(empleados): bloque Costos de personal en el libro y advertencia al cierre"
```

---

### Task 12: Verificación e2e en dev + autorización

**Files:**
- (sin código nuevo salvo fixes que surjan)

- [ ] **Step 1: Autorización negativa (manual, local o dev)**

Con un usuario VALIDADOR o CARGADOR (en dev: `ggarnelo@kawellu.com.ar` si se conoce la clave, o crear uno con `scripts/crear-usuario.ts <email> <nombre> <pass> VALIDADOR ewwo`):
- La entrada "Empleados" NO aparece en el sidebar.
- Navegar a `/{slug}/empleados` a mano → redirige a `/403`.
- En Movimientos, la card "Costos de personal" SÍ aparece (agregado, sin detalle).

- [ ] **Step 2: Deploy a dev (192.168.44.150)**

Seguir el procedimiento de memoria (`servidor-dev-pnl`): rsync con los excludes anclados SIN `--delete`, `npx prisma db push` en el server, build y restart de `pnl-web`/`pnl-worker`. Verificar `EXTRACTOR_MODE=real` y `ANTHROPIC_API_KEY` presentes en el `.env` del server para que la extracción sea real.

- [ ] **Step 3: E2E con el PDF real**

Como admin en la empresa **ewwo**: subir `Docs/RecibosSueldoEwwo/Recibos_Ewwo Consulting SRL_2026-08.pdf` desde la sección Empleados. Verificar:
- Se crean 13 empleados (primera vez: todos quedan PENDIENTE_REVISION por "empleado nuevo sin distribución").
- Los 13 `costoTotalEmpleador` coinciden con el PDF; en particular: FRONTERA 5.991.291,14 · DIODATI 5.284.760,31 · FAZZINI 5.993.554,02 · ARANDA 1.028.347,29 · GODOY 1.054.673,29 · SAENZ 2.011.082,96.
- Cargar distribución a un empleado, confirmar su recibo → aparece en el bloque "Costos de personal" de Movimientos con el desglose correcto.
- Subir el MISMO PDF de nuevo → los 13 nuevos recibos quedan ANULADO con nota de duplicado (el primero ingresado gana).
- Vincular un comprobante ASIGNADO a un empleado con un monto parcial → en Movimientos el comprobante descuenta esa porción y "Costos de personal" la suma.

- [ ] **Step 4: Correr la suite completa una última vez y push**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde. Después `git push`.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec:** modelo de datos → Task 1; ingesta/extracción → Tasks 3-6; control aritmético → Task 2; estados/duplicados/período cerrado → Tasks 5-6; sección UI (listado, pendientes, ficha, revisión, vínculos) → Tasks 9-10; sidebar admin-only → Task 9; consolidación P&L sin doble conteo → Tasks 7 y 11; CSV → Task 11; advertencia de cierre → Task 11; congelamiento por período → Task 8 (`reciboEditable`/guardas de vínculo); auditoría → Tasks 6 y 8; autorización y e2e → Task 12. Fuera de alcance del spec respetado (sin provisión SAC, sin email/telegram, sin gráfico).
- **Desviaciones del spec:** documentadas en Global Constraints (enum de estados reducido; unique de duplicado en código). 
- **Consistencia de tipos:** `TotalesRecibo` (Task 2) se consume en Tasks 6, 8, 9; `LineaDistribucion` viene siempre de `lib/movimientos/distribucion`; `ReciboExtraccion` (Task 3) sólo se consume en Task 6; `montoVinculadoCentavos`/`vinculosEmpleados` (Task 7) se consumen en Task 11.
- **Puntos donde el implementador DEBE leer código antes de escribir:** props reales de `DistribucionEditor` (Tasks 9-10), nombre del icono en `iconos.tsx` (Task 9), estructura real de `export/route.ts` y `periodos/page.tsx` (Task 11), nombre de la relación `periodo` en `Movimiento` (Task 8).
