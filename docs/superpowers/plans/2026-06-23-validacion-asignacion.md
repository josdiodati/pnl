# Spec A — Desacople Validación/Asignación + Cliente/Proyecto · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar la validación fiscal de la asignación interna de un comprobante: nuevo estado `ASIGNADO` (lo único que impacta el P&L), cola de Asignación, y la dimensión cliente/proyecto abierta en dos maestros (`Cliente` + `Proyecto`).

**Architecture:** Estados lineales `… → VALIDADO → ASIGNADO`. Se renombra el modelo `ClienteProyecto`→`Cliente` y su FK `clienteProyectoId`→`clienteId`, se agrega el modelo `Proyecto` + FK `proyectoId` opcional en las líneas. `validarMovimiento` pasa a ser solo-fiscal; se agrega `asignarMovimiento`. Dos colas: Validación (existente) y Asignación (nueva).

**Tech Stack:** Next.js (App Router), TypeScript, Prisma + Postgres, vitest, tsx. Deploy a `192.168.44.150` por rsync.

## Global Constraints

- Asignación de un comprobante = **Categoría** (obligatoria, una por comprobante) + **Centro de Costo** (obligatorio) + **Cliente** (opcional) + **Proyecto** (opcional).
- Reparto **por línea**: cada línea = `centroCostoId` (req) + `clienteId?` + `proyectoId?` + `porcentaje`; las líneas suman 100.0000 exacto.
- **Estado lineal**: `PENDIENTE_VALIDACION → VALIDADO → ASIGNADO`. `impactaResultado === 'ASIGNADO'`.
- Regla unificadora de validación: `validarMovimiento` pasa a `ASIGNADO` si el movimiento ya tiene categoría + líneas que suman 100 (manuales); si no, a `VALIDADO` (comprobantes capturados).
- Cierre de período bloquea si hay `PENDIENTE_VALIDACION`, `OBSERVADO`, `RETENIDO` o `VALIDADO` (sin asignar).
- Tests con `vitest` (`npm test`); alias `@/`. Mantener verde la suite de aislamiento multiempresa.
- Cada tarea debe dejar `npm run typecheck` limpio.

---

## File Structure

- `prisma/schema.prisma` — MODIFICAR: rename `ClienteProyecto`→`Cliente` + FK `clienteProyectoId`→`clienteId`; nuevo `Proyecto` + `proyectoId` en `MovimientoLinea` y `PlantillaDistribucionLinea`; enum `ASIGNADO`.
- `lib/empresa/scope.ts` — MODIFICAR: `SCOPED_MODELS` (`ClienteProyecto`→`Cliente`, +`Proyecto`).
- `lib/movimientos/distribucion.ts` — MODIFICAR: `LineaDistribucion` (`clienteId?` + `proyectoId?`).
- `lib/movimientos/estados.ts` — MODIFICAR: estado `ASIGNADO`, transiciones, `impactaResultado`, label.
- `lib/movimientos/service.ts` — MODIFICAR: `reemplazarLineas`, `validarMovimiento`, nuevo `asignarMovimiento`, `crearMovimientoManual`, `cerrarPeriodo`.
- `lib/movimientos/query.ts` — MODIFICAR: impacto P&L `ASIGNADO`, line shape `clienteId/proyectoId`.
- `components/distribucion-editor.tsx` — MODIFICAR: selects Cliente + Proyecto.
- `components/validacion-form.tsx` — MODIFICAR: quitar campos de imputación.
- `app/(app)/[empresaSlug]/validacion/actions.ts` + `validacion/[id]/page.tsx` — MODIFICAR.
- `app/(app)/[empresaSlug]/asignacion/page.tsx` + `asignacion/[id]/page.tsx` + `asignacion/actions.ts` — CREAR.
- `app/(app)/[empresaSlug]/maestros/clientes/` (rename de `clientes-proyectos/`) + `maestros/proyectos/` (nuevo) + `maestros/actions.ts` — MODIFICAR/CREAR.
- `app/(app)/[empresaSlug]/layout.tsx` — MODIFICAR: nav (Asignación, Clientes, Proyectos).
- `prisma/seed.ts` — MODIFICAR: usa `cliente`/`proyecto` si aplica (hoy no crea ninguno; revisar).
- Tests: `tests/estados.test.ts` (extender), `tests/asignacion.test.ts` (nuevo), `tests/distribucion.test.ts` (ajustar).

---

## Task 1: Rename `ClienteProyecto` → `Cliente` (+ FK `clienteProyectoId` → `clienteId`)

Rename mecánico en todo el repo, sin cambio de comportamiento. Deja todo compilando.

**Files:** `prisma/schema.prisma`, `lib/empresa/scope.ts`, `lib/movimientos/distribucion.ts`, `lib/movimientos/service.ts`, `lib/movimientos/query.ts`, `components/distribucion-editor.tsx`, `app/(app)/[empresaSlug]/maestros/actions.ts`, `app/(app)/[empresaSlug]/maestros/clientes-proyectos/page.tsx`, `app/(app)/[empresaSlug]/validacion/actions.ts`, `app/(app)/[empresaSlug]/validacion/[id]/page.tsx`, `app/(app)/[empresaSlug]/movimientos/page.tsx`, `app/(app)/[empresaSlug]/ventas/page.tsx`, `prisma/seed.ts`.

- [ ] **Step 1: Inventariar referencias**

```bash
cd /home/jdiodati/projects/PNL
grep -rn "ClienteProyecto\|clienteProyecto" --include=*.ts --include=*.tsx --include=*.prisma . | grep -v node_modules | grep -v "/.next/"
```
Expected: lista de ~20-30 ocurrencias en los archivos de arriba.

- [ ] **Step 2: Schema — renombrar modelo y FK**

En `prisma/schema.prisma`:
- `model ClienteProyecto {` → `model Cliente {`
- En `Cliente`: dejar las relaciones inversas como `lineas MovimientoLinea[]` y `plantillaLineas PlantillaDistribucionLinea[]` (sin cambio).
- En `MovimientoLinea`: `clienteProyectoId String? // second dimension, optional` → `clienteId String?`; y `clienteProyecto   ClienteProyecto? @relation(fields: [clienteProyectoId], references: [id])` → `cliente   Cliente? @relation(fields: [clienteId], references: [id])`.
- En `PlantillaDistribucionLinea`: `clienteProyectoId String?` → `clienteId String?`; y la relación `clienteProyecto   ClienteProyecto?  @relation(fields: [clienteProyectoId], references: [id])` → `cliente   Cliente?  @relation(fields: [clienteId], references: [id])`.
- En `model Empresa` y donde haya `clienteProyectos ClienteProyecto[]` (relación inversa) → `clientes Cliente[]` (verificar el nombre real con grep del Step 1 y renombrar la propiedad).

- [ ] **Step 3: Renombrar en el código (delegate, tipos, campos)**

Aplicar estos reemplazos exactos (verificá cada archivo del Step 1):
- `prisma.clienteProyecto` / `ctx.db.clienteProyecto` → `prisma.cliente` / `ctx.db.cliente`
- tipo `ClienteProyecto` (imports de `@prisma/client`) → `Cliente`
- `clienteProyectoId` → `clienteId` (campos en `data`, `where`, `select`, includes `clienteProyecto: true` → `cliente: true`, accesos `l.clienteProyecto` → `l.cliente`, `m.clienteProyecto` → `m.cliente`)
- En `lib/movimientos/distribucion.ts`: `LineaDistribucion.clienteProyectoId` → `clienteId`.
- En `lib/movimientos/query.ts`: el tipo de línea `clienteProyectoId` → `clienteId`; `porClienteProyecto` Map y `f.clienteProyectoId` filtro → `porCliente` / `f.clienteId` (renombrar la key del filtro `FiltrosMovimientos.clienteProyectoId` → `clienteId`).
- En `components/distribucion-editor.tsx`: prop `clientes` queda; `LineaEditor.clienteProyectoId` → `clienteId`; input `name="linea_clienteProyectoId"` → `name="linea_clienteId"`; `aplicarPlantilla` usa `l.clienteProyectoId` → `l.clienteId`.
- En las server actions que leen `linea_clienteProyectoId` (`maestros/actions.ts` o `validacion/actions.ts` `leerLineas`) → `linea_clienteId`.
- En `maestros/clientes-proyectos/page.tsx`, `movimientos/page.tsx`, `ventas/page.tsx`: accesos `clienteProyecto`/`clienteProyectoId` → `cliente`/`clienteId`.
- `prisma/seed.ts`: si referencia `clienteProyecto`, renombrar (hoy el seed real no crea ninguno; confirmar con grep).

- [ ] **Step 4: Aplicar a la base y regenerar cliente**

Run: `npx prisma db push`
Expected: "in sync" + cliente regenerado. (Postgres renombra columna/tabla; la base de dev no tiene datos en esas tablas para Kawellu/Ewwo.)

- [ ] **Step 5: Typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: typecheck sin errores; suite verde (mismos tests, sin cambios de comportamiento).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: renombrar ClienteProyecto -> Cliente (FK clienteProyectoId -> clienteId)"
```

---

## Task 2: Modelo `Proyecto` + `proyectoId` en líneas

**Files:** Modify `prisma/schema.prisma`, `lib/empresa/scope.ts`, `lib/movimientos/distribucion.ts`. Test: `tests/distribucion.test.ts`.

**Interfaces:**
- Produces: modelo Prisma `Proyecto` (`id, empresaId, nombre, codigo?, activo`); `MovimientoLinea.proyectoId String?` + relación `proyecto Proyecto?`; `PlantillaDistribucionLinea.proyectoId String?`; `LineaDistribucion` gana `proyectoId?: string | null`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/distribucion.test.ts`:

```typescript
import { validarDistribucion } from '@/lib/movimientos/distribucion';

describe('distribución con cliente y proyecto por línea', () => {
  it('acepta líneas con cliente y proyecto opcionales que suman 100', () => {
    expect(() => validarDistribucion([
      { centroCostoId: 'cc1', clienteId: 'cli1', proyectoId: 'pr1', porcentaje: 60 },
      { centroCostoId: 'cc2', clienteId: null, proyectoId: null, porcentaje: 40 },
    ])).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr y ver fallar (typecheck del test)**

Run: `npm test -- tests/distribucion.test.ts`
Expected: FALLA al compilar (`proyectoId` no existe en `LineaDistribucion`).

- [ ] **Step 3: Agregar `proyectoId` al tipo**

En `lib/movimientos/distribucion.ts`, el tipo:

```typescript
export type LineaDistribucion = {
  centroCostoId: string;
  clienteId?: string | null;
  proyectoId?: string | null;
  porcentaje: number; // 0 < p <= 100, up to 4 decimals
};
```

(`validarDistribucion` no cambia su lógica: sigue validando centro + suma 100.)

- [ ] **Step 4: Agregar modelo `Proyecto` + FKs al schema**

En `prisma/schema.prisma`, después del modelo `Cliente`:

```prisma
model Proyecto {
  id        String  @id @default(cuid())
  empresaId String
  nombre    String
  codigo    String?
  activo    Boolean @default(true)
  empresa   Empresa @relation(fields: [empresaId], references: [id])
  lineas    MovimientoLinea[]
  plantillaLineas PlantillaDistribucionLinea[]

  @@unique([empresaId, nombre])
}
```

En `MovimientoLinea` agregar: `proyectoId String?` y `proyecto Proyecto? @relation(fields: [proyectoId], references: [id])`.
En `PlantillaDistribucionLinea` agregar: `proyectoId String?` y `proyecto Proyecto? @relation(fields: [proyectoId], references: [id])`.
En `model Empresa` agregar la relación inversa: `proyectos Proyecto[]`.

- [ ] **Step 5: Scope — agregar Proyecto a SCOPED_MODELS**

En `lib/empresa/scope.ts`, en el `Set` `SCOPED_MODELS` agregar `'Proyecto'` (junto a `'Cliente'`).

- [ ] **Step 6: db push + typecheck + test**

Run: `npx prisma db push && npm run typecheck && npm test -- tests/distribucion.test.ts`
Expected: in sync; typecheck OK; test PASA.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(db): modelo Proyecto + proyectoId opcional en líneas"
```

---

## Task 3: Estado `ASIGNADO` + máquina de estados

**Files:** Modify `prisma/schema.prisma` (enum), `lib/movimientos/estados.ts`. Test: `tests/estados.test.ts`.

**Interfaces:**
- Produces: enum `EstadoMovimiento` con `ASIGNADO`; transiciones `VALIDADO↔ASIGNADO`, `ASIGNADO→ANULADO`; `impactaResultado(e) === (e === 'ASIGNADO')`; `ESTADO_LABEL.ASIGNADO = 'Asignado'`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/estados.test.ts`:

```typescript
import { puedeTransicionar, impactaResultado, ESTADO_LABEL } from '@/lib/movimientos/estados';

describe('estado ASIGNADO', () => {
  it('VALIDADO puede pasar a ASIGNADO y a ANULADO', () => {
    expect(puedeTransicionar('VALIDADO', 'ASIGNADO')).toBe(true);
    expect(puedeTransicionar('VALIDADO', 'ANULADO')).toBe(true);
  });
  it('ASIGNADO puede des-asignarse (→VALIDADO) o anularse', () => {
    expect(puedeTransicionar('ASIGNADO', 'VALIDADO')).toBe(true);
    expect(puedeTransicionar('ASIGNADO', 'ANULADO')).toBe(true);
  });
  it('solo ASIGNADO impacta el resultado', () => {
    expect(impactaResultado('ASIGNADO')).toBe(true);
    expect(impactaResultado('VALIDADO')).toBe(false);
  });
  it('tiene label', () => {
    expect(ESTADO_LABEL.ASIGNADO).toBe('Asignado');
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm test -- tests/estados.test.ts`
Expected: FALLA (ASIGNADO no existe / transiciones falsas).

- [ ] **Step 3: Enum en el schema**

En `prisma/schema.prisma`, enum `EstadoMovimiento`, agregar `ASIGNADO` después de `VALIDADO`.

- [ ] **Step 4: Actualizar `estados.ts`**

En `lib/movimientos/estados.ts`:
- En `TRANSICIONES`: cambiar `VALIDADO: ['ANULADO'],` por `VALIDADO: ['ASIGNADO', 'ANULADO'],` y agregar la entrada `ASIGNADO: ['VALIDADO', 'ANULADO'],`.
- `impactaResultado`: `return estado === 'ASIGNADO';` (y actualizar el comentario "Only ASIGNADO hits the P&L").
- `ESTADO_LABEL`: agregar `ASIGNADO: 'Asignado',`.

- [ ] **Step 5: db push + test + typecheck**

Run: `npx prisma db push && npm test -- tests/estados.test.ts && npm run typecheck`
Expected: in sync; PASA; typecheck OK.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(estados): ASIGNADO + transiciones; impactaResultado=ASIGNADO"
```

---

## Task 4: Desacople en el servicio (`validarMovimiento` + `asignarMovimiento`)

**Files:** Modify `lib/movimientos/service.ts`. Test: `tests/asignacion.test.ts` (nuevo).

**Interfaces:**
- Consumes: `LineaDistribucion` (con `clienteId?`/`proyectoId?`), estados.
- Produces:
  - `puedeAsignar(estado): boolean` (pura, exportada) — `true` para `VALIDADO`/`ASIGNADO`.
  - `tieneAsignacionCompleta(categoriaId, lineas): boolean` (pura, exportada) — categoría presente y líneas suman 100.
  - `validarMovimiento(ctx, id, datosFiscales)` — sin categoría/líneas; transiciona a `ASIGNADO` si el mov ya tenía asignación, si no a `VALIDADO`.
  - `asignarMovimiento(ctx, id, { categoriaId, lineas })` → `ASIGNADO`.

- [ ] **Step 1: Escribir los tests puros que fallan**

Crear `tests/asignacion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { puedeAsignar, tieneAsignacionCompleta } from '@/lib/movimientos/service';

describe('helpers de asignación', () => {
  it('puedeAsignar solo desde VALIDADO o ASIGNADO', () => {
    expect(puedeAsignar('VALIDADO')).toBe(true);
    expect(puedeAsignar('ASIGNADO')).toBe(true);
    expect(puedeAsignar('PENDIENTE_VALIDACION')).toBe(false);
  });
  it('tieneAsignacionCompleta exige categoría y líneas que suman 100', () => {
    expect(tieneAsignacionCompleta('cat1', [{ centroCostoId: 'cc', porcentaje: 100 }])).toBe(true);
    expect(tieneAsignacionCompleta(null, [{ centroCostoId: 'cc', porcentaje: 100 }])).toBe(false);
    expect(tieneAsignacionCompleta('cat1', [{ centroCostoId: 'cc', porcentaje: 50 }])).toBe(false);
    expect(tieneAsignacionCompleta('cat1', [])).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm test -- tests/asignacion.test.ts`
Expected: FALLA (`puedeAsignar`/`tieneAsignacionCompleta` no existen).

- [ ] **Step 3: Implementar helpers puros**

En `lib/movimientos/service.ts`, agregar (cerca del top, después de imports):

```typescript
import { puedeTransicionar } from './estados';

/** Asignar requiere estar fiscalmente validado (o re-asignar). */
export function puedeAsignar(estado: string): boolean {
  return estado === 'VALIDADO' || estado === 'ASIGNADO';
}

/** ¿El movimiento ya tiene imputación completa (categoría + líneas que suman 100)? */
export function tieneAsignacionCompleta(categoriaId: string | null | undefined, lineas: LineaDistribucion[]): boolean {
  if (!categoriaId || !lineas.length) return false;
  const suma = lineas.reduce((a, l) => a + Math.round(l.porcentaje * 10000), 0);
  return suma === 1000000 && lineas.every((l) => l.centroCostoId);
}
```

- [ ] **Step 4: `reemplazarLineas` con cliente/proyecto**

En `reemplazarLineas`, validar pertenencia y mapear el nuevo shape:

```typescript
async function reemplazarLineas(ctx: EmpresaContext, movimientoId: string, lineas: LineaDistribucion[]): Promise<void> {
  validarDistribucion(lineas);
  for (const linea of lineas) {
    const cc = await ctx.db.centroCosto.findFirst({ where: { id: linea.centroCostoId } });
    if (!cc) throw new DomainError('Centro de costo inexistente en esta empresa.');
    if (linea.clienteId) {
      const cli = await ctx.db.cliente.findFirst({ where: { id: linea.clienteId } });
      if (!cli) throw new DomainError('Cliente inexistente en esta empresa.');
    }
    if (linea.proyectoId) {
      const pr = await ctx.db.proyecto.findFirst({ where: { id: linea.proyectoId } });
      if (!pr) throw new DomainError('Proyecto inexistente en esta empresa.');
    }
  }
  await prisma.movimientoLinea.deleteMany({ where: { movimientoId } });
  await prisma.movimientoLinea.createMany({
    data: lineas.map((l) => ({
      movimientoId,
      centroCostoId: l.centroCostoId,
      clienteId: l.clienteId ?? null,
      proyectoId: l.proyectoId ?? null,
      porcentaje: l.porcentaje,
    })),
  });
}
```

- [ ] **Step 5: `validarMovimiento` solo-fiscal + regla unificadora**

Modificar `DatosValidacion`: quitar `categoriaId` y `lineas` (dejar los campos fiscales + `confirmarArcaInvalido`/`overrideNoFiscal*` + `instruccionesExtraccion`). En `validarMovimiento`, quitar la exigencia de categoría/líneas y el `reemplazarLineas`; tras escribir los campos fiscales, decidir el estado destino:

```typescript
  // Estado destino: si ya viene con imputación (manuales), ASIGNADO; si no, VALIDADO.
  const lineasActuales = await ctx.db.movimientoLinea.findMany({ where: { movimientoId: mov.id } });
  const yaAsignado = tieneAsignacionCompleta(
    mov.categoriaId,
    lineasActuales.map((l) => ({ centroCostoId: l.centroCostoId, clienteId: l.clienteId, proyectoId: l.proyectoId, porcentaje: Number(l.porcentaje) })),
  );
  const estadoDestino = yaAsignado ? 'ASIGNADO' : 'VALIDADO';
  assertTransicion(mov.estado, estadoDestino);
```
Usar `estadoDestino` en el `update` (`estado: estadoDestino`). Quitar de `validarMovimiento` la escritura de `categoriaId`/líneas (esos los maneja `asignarMovimiento`). Mantener el gate de ARCA (`puedeValidarArca`) y la auditoría `VALIDAR`.

- [ ] **Step 6: `asignarMovimiento`**

Agregar:

```typescript
export type DatosAsignacion = { categoriaId: string; lineas: LineaDistribucion[] };

export async function asignarMovimiento(ctx: EmpresaContext, id: string, datos: DatosAsignacion): Promise<void> {
  const mov = await getMovimientoOrThrow(ctx, id);
  if (!puedeAsignar(mov.estado)) throw new DomainError('Solo se pueden asignar comprobantes validados.');
  const categoria = await ctx.db.categoria.findFirst({ where: { id: datos.categoriaId, activa: true } });
  if (!categoria) throw new DomainError('Elegí una categoría válida.');
  if (mov.fechaDevengamiento) await assertPeriodoAbierto(ctx, mov.fechaDevengamiento, 'asignar');
  const antes = snapshot(mov);
  await reemplazarLineas(ctx, mov.id, datos.lineas);
  assertTransicion(mov.estado, 'ASIGNADO');
  const actualizado = await ctx.db.movimiento.update({
    where: { id: mov.id },
    data: { estado: 'ASIGNADO', categoriaId: datos.categoriaId, validadoPorId: ctx.usuario.id },
  });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id, entidad: 'Movimiento', entidadId: mov.id, accion: 'ASIGNAR',
    antes, despues: { ...snapshot(actualizado), lineas: datos.lineas },
  });
}
```
(Nota: `assertTransicion(VALIDADO→ASIGNADO)` y `ASIGNADO→ASIGNADO`. Para re-asignar desde ASIGNADO, permitir la transición reflexiva: agregar `'ASIGNADO'` a `TRANSICIONES.ASIGNADO` en estados.ts, o saltar el assert cuando `mov.estado === 'ASIGNADO'`. Usar el salto: `if (mov.estado !== 'ASIGNADO') assertTransicion(mov.estado, 'ASIGNADO');`.)

- [ ] **Step 7: `crearMovimientoManual` → ASIGNADO directo**

En `crearMovimientoManual`, el estado validado-directo pasa de `VALIDADO` a `ASIGNADO` (el manual trae imputación): cambiar `const estado = validaDirecto ? 'VALIDADO' : 'PENDIENTE_VALIDACION';` por `const estado = validaDirecto ? 'ASIGNADO' : 'PENDIENTE_VALIDACION';`. Verificar `esEstadoInicialValido` (estados.ts `ESTADOS_INICIALES`) para permitir `ASIGNADO` como inicial de `ASIENTO_MANUAL`/`VENTA_MANUAL`: agregar `'ASIGNADO'` a ambas listas.

- [ ] **Step 8: typecheck + tests**

Run: `npm run typecheck && npm test -- tests/asignacion.test.ts`
Expected: typecheck OK; PASA.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(service): desacople validar/asignar (validarMovimiento fiscal + asignarMovimiento)"
```

---

## Task 5: Cierre de período bloquea por asignación + P&L cuenta ASIGNADO

**Files:** Modify `lib/movimientos/service.ts` (`cerrarPeriodo`), `lib/movimientos/query.ts` (`resumirMovimientos`). Test: `tests/asignacion.test.ts` (extender con un helper puro).

**Interfaces:**
- Produces: `cerrarPeriodo` cuenta `['PENDIENTE_VALIDACION','OBSERVADO','RETENIDO','VALIDADO']` como sin-resolver; `resumirMovimientos` suma solo `ASIGNADO`.

- [ ] **Step 1: Ajustar el resumen del P&L**

En `lib/movimientos/query.ts`, `resumirMovimientos`: cambiar `if (mov.estado !== 'VALIDADO') continue;` por `if (mov.estado !== 'ASIGNADO') continue;`. Actualizar el comentario ("only ASIGNADO").

- [ ] **Step 2: Gate de cierre**

En `lib/movimientos/service.ts`, `cerrarPeriodo`: cambiar el `where` del conteo `sinResolver` a:

```typescript
      estado: { in: ['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'VALIDADO'] },
```
y el mensaje de error a algo como: `No se puede cerrar ${nombrePeriodo(anio, mes)}: hay ${sinResolver} movimiento(s) sin validar o sin asignar en ese mes. Resolvelos (validar + asignar) o anulalos primero.`

- [ ] **Step 3: Test del gate (helper puro)**

En `lib/movimientos/estados.ts` agregar un helper puro y testearlo:

```typescript
export const ESTADOS_BLOQUEAN_CIERRE: EstadoMovimiento[] = ['PENDIENTE_VALIDACION', 'OBSERVADO', 'RETENIDO', 'VALIDADO'];
export function bloqueaCierre(estado: EstadoMovimiento): boolean {
  return ESTADOS_BLOQUEAN_CIERRE.includes(estado);
}
```
En `cerrarPeriodo`, usar `ESTADOS_BLOQUEAN_CIERRE` en el `in`. Test en `tests/estados.test.ts`:

```typescript
import { bloqueaCierre } from '@/lib/movimientos/estados';
describe('bloqueo de cierre', () => {
  it('VALIDADO sin asignar bloquea; ASIGNADO no', () => {
    expect(bloqueaCierre('VALIDADO')).toBe(true);
    expect(bloqueaCierre('ASIGNADO')).toBe(false);
    expect(bloqueaCierre('PENDIENTE_VALIDACION')).toBe(true);
  });
});
```

- [ ] **Step 4: typecheck + tests**

Run: `npm run typecheck && npm test -- tests/estados.test.ts`
Expected: OK; PASA.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(periodos/pyl): cierre bloquea por validación o asignación; P&L cuenta ASIGNADO"
```

---

## Task 6: Maestros — `Cliente` (rename de UI) + nuevo master `Proyecto`

**Files:**
- Rename dir: `app/(app)/[empresaSlug]/maestros/clientes-proyectos/` → `maestros/clientes/` (page.tsx).
- Create: `app/(app)/[empresaSlug]/maestros/proyectos/page.tsx`.
- Modify: `app/(app)/[empresaSlug]/maestros/actions.ts` (acciones de cliente; nuevas de proyecto).
- Modify: `app/(app)/[empresaSlug]/layout.tsx` (nav).

**Interfaces:**
- Consumes: `ctx.db.cliente`, `ctx.db.proyecto`.
- Produces: acciones `guardarCliente`/`toggleCliente` (rename de `guardarClienteProyecto`/`toggleClienteProyecto`) y `guardarProyecto`/`toggleProyecto`; rutas `/maestros/clientes` y `/maestros/proyectos`.

- [ ] **Step 1: Renombrar la sección Clientes**

```bash
git mv "app/(app)/[empresaSlug]/maestros/clientes-proyectos" "app/(app)/[empresaSlug]/maestros/clientes"
```
En `maestros/clientes/page.tsx`: cambiar textos "Cliente / proyecto" → "Cliente", "Nuevo cliente / proyecto" → "Nuevo cliente", los `href`/`volver` de `clientes-proyectos` → `clientes`, y usar `ctx.db.cliente` + acciones `guardarCliente`/`toggleCliente` (ver Step 2).

- [ ] **Step 2: Acciones de Cliente (rename) en `maestros/actions.ts`**

Renombrar `guardarClienteProyecto`→`guardarCliente` y `toggleClienteProyecto`→`toggleCliente`; dentro, `ctx.db.clienteProyecto`→`ctx.db.cliente`, `entidad: 'ClienteProyecto'`→`'Cliente'`, y `volver(slug, 'clientes-proyectos', ...)`→`volver(slug, 'clientes', ...)`. (La lógica id→update / else→create se mantiene.)

- [ ] **Step 3: Crear la sección Proyectos (clon de Clientes)**

Crear `app/(app)/[empresaSlug]/maestros/proyectos/page.tsx` clonando `maestros/clientes/page.tsx` con estos cambios: usar `ctx.db.proyecto`, textos "Proyecto"/"Nuevo proyecto", acciones `guardarProyecto`/`toggleProyecto`, `href`/`volver` con `'proyectos'`, placeholder de nombre "Proyecto MicroIT".

En `maestros/actions.ts`, agregar `guardarProyecto`/`toggleProyecto` clonando `guardarCliente`/`toggleCliente` pero con `ctx.db.proyecto`, `entidad: 'Proyecto'`, `volver(slug, 'proyectos', ...)`.

- [ ] **Step 4: Nav — reactivar Clientes + Proyectos**

En `app/(app)/[empresaSlug]/layout.tsx`, reemplazar el bloque comentado de Clientes/Proyectos por dos items reales (después de "Centros de costo"):

```tsx
              { href: `${base}/maestros/clientes`, label: 'Clientes', icono: 'cliente' },
              { href: `${base}/maestros/proyectos`, label: 'Proyectos', icono: 'cliente' },
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(maestros): Clientes (rename) + nuevo master Proyectos; reactivar en nav"
```

---

## Task 7: `DistribucionEditor` con Cliente + Proyecto

**Files:** Modify `components/distribucion-editor.tsx`.

**Interfaces:**
- Produces: el editor acepta props `clientes: OpcionId[]` y `proyectos: OpcionId[]`; cada fila tiene selects de cliente y proyecto; inputs `linea_clienteId` y `linea_proyectoId`; `LineaEditor` con `clienteId`/`proyectoId`; `PlantillaOpcion.lineas` con `clienteId`/`proyectoId`.

- [ ] **Step 1: Agregar la dimensión Proyecto al editor**

En `components/distribucion-editor.tsx`:
- `LineaEditor`: `{ centroCostoId: string; clienteId: string; proyectoId: string; porcentaje: string }`.
- Prop nueva `proyectos: OpcionId[]` (junto a `clientes`).
- `filaVacia()`: agregar `proyectoId: ''`.
- `aplicarPlantilla`: mapear `clienteId`/`proyectoId` desde `p.lineas`.
- En cada fila, después del select de cliente (input `name="linea_clienteId"`, "Sin cliente"), agregar un select análogo `name="linea_proyectoId"` con opción "Sin proyecto" y `proyectos.map(...)`.
- `PlantillaOpcion.lineas`: `{ centroCostoId; clienteId: string | null; proyectoId: string | null; porcentaje }`.
- Texto del encabezado: "Asignación (centro de costo + cliente + proyecto)".

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: errores en los call-sites que aún no pasan `proyectos` (se arreglan en Tasks 8 y 9). Si el typecheck falla solo por eso, está esperado; igual confirmá que el archivo del editor compila aislado revisando que no haya otros errores en `distribucion-editor.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/distribucion-editor.tsx && git commit -m "feat(ui): DistribucionEditor con Cliente + Proyecto"
```

---

## Task 8: Validación queda solo-fiscal

**Files:** Modify `components/validacion-form.tsx`, `app/(app)/[empresaSlug]/validacion/[id]/page.tsx`, `app/(app)/[empresaSlug]/validacion/actions.ts`.

**Interfaces:**
- Consumes: `validarMovimiento(ctx, id, datosFiscales)` (sin categoría/líneas).
- Produces: el form de validación sin campos de imputación; `validarAction` sin leer categoría/líneas.

- [ ] **Step 1: Quitar imputación del form**

En `components/validacion-form.tsx`: eliminar los inputs/selects de **categoría**, **contraparte inline nueva** (si corresponde mantener contraparte, dejar; la contraparte es fiscal, NO es imputación → **mantener** contraparte y CUIT), y todo el bloque de **distribución** (`DistribucionEditor` y campos `linea_*`). Quitar de las props del componente `categorias`, `centros`, `clientes`, `proyectos`, `plantillas` y `lineas` iniciales. Mantener: fechas, importes, tipo/PV/número, CAE, CUIT/contraparte, ARCA + overrides, instrucciones de extracción, botón "Validar y siguiente".

- [ ] **Step 2: Ajustar la página de detalle de validación**

En `validacion/[id]/page.tsx`: dejar de cargar/pasar `categorias`, `centros`, `clientes`, `proyectos`, `plantillas` al `ValidacionForm` (quedan para Asignación). Mantener visor, datos fiscales e historial.

- [ ] **Step 3: `validarAction` sin imputación**

En `validacion/actions.ts`, `validarAction`: quitar la lectura de `categoriaId` y `leerLineas(formData)`; quitar el bloque de creación inline de contraparte sólo si dependía de imputación (la contraparte es fiscal → si el form la mantiene, conservar esa lógica). Llamar `validarMovimiento(ctx, movimientoId, { ...campos fiscales..., confirmarArcaInvalido, overrideNoFiscal, overrideNoFiscalMotivo, cuitEmisor, contraparteId, instruccionesExtraccion })` (sin `categoriaId`/`lineas`). El redirect "siguiente" busca el próximo `PENDIENTE_VALIDACION` (sin cambios).

- [ ] **Step 4: typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: typecheck OK (ya con Task 9 los call-sites de Asignación existen — si se ejecuta antes que la 9, ver nota); suite verde.

> Nota de orden: las Tasks 8 y 9 se tocan entre sí (el editor ahora vive en Asignación). Ejecutar 7→8→9 y correr el typecheck recién al final de la 9 si quedara algún call-site colgado.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(validacion): el form de validación queda solo-fiscal"
```

---

## Task 9: Cola de Asignación (página + acción)

**Files:**
- Create: `app/(app)/[empresaSlug]/asignacion/page.tsx` (lista), `app/(app)/[empresaSlug]/asignacion/[id]/page.tsx` (detalle), `app/(app)/[empresaSlug]/asignacion/actions.ts`.
- Modify: `app/(app)/[empresaSlug]/layout.tsx` (nav: item "Asignación").

**Interfaces:**
- Consumes: `asignarMovimiento(ctx, id, { categoriaId, lineas })`, `DistribucionEditor` (con `proyectos`).
- Produces: ruta `/asignacion` (lista de `VALIDADO`), `/asignacion/[id]` (form de asignación), `asignarAction(formData)`.

- [ ] **Step 1: Acción `asignarAction`**

Crear `asignacion/actions.ts` (basado en el patrón de `validacion/actions.ts`): leer `empresaSlug`, `movimientoId`, `categoriaId`, y las líneas con `leerLineas` (que ahora lee `linea_centroCostoId`/`linea_clienteId`/`linea_proyectoId`/`linea_porcentaje`); `requireEmpresa(slug, 'VALIDADOR')`; llamar `asignarMovimiento(ctx, movimientoId, { categoriaId, lineas })`; redirect al siguiente `VALIDADO` o a `/asignacion?ok=...`. Reusar `volverConError`.

```typescript
function leerLineas(formData: FormData) {
  const ccIds = formData.getAll('linea_centroCostoId').map(String);
  const cliIds = formData.getAll('linea_clienteId').map(String);
  const prIds = formData.getAll('linea_proyectoId').map(String);
  const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
  return ccIds
    .map((cc, i) => ({ centroCostoId: cc, clienteId: cliIds[i] || null, proyectoId: prIds[i] || null, porcentaje: pcts[i] }))
    .filter((l) => l.centroCostoId);
}
```

- [ ] **Step 2: Lista de Asignación**

Crear `asignacion/page.tsx` clonando la estructura de `validacion/page.tsx` pero con `where: { estado: 'VALIDADO' }` (validador ve todo; cargador ve solo lo suyo si aplica), columnas: contraparte, comprobante, fecha, total, y link "Asignar" → `/asignacion/[id]`. Encabezado "Cola de Asignación".

- [ ] **Step 3: Detalle de Asignación**

Crear `asignacion/[id]/page.tsx`: carga el movimiento (`estado VALIDADO` o `ASIGNADO`), el visor del documento, y un form que postea a `asignarAction` con: hidden `empresaSlug`/`movimientoId`, **select de Categoría** (`name="categoriaId"`, de `ctx.db.categoria` activas), y `<DistribucionEditor centros={...} clientes={...} proyectos={...} plantillas={...} totalFirmado={...} />`. Cargar `centros` (`ctx.db.centroCosto` activos), `clientes` (`ctx.db.cliente` activos), `proyectos` (`ctx.db.proyecto` activos), `plantillas` (`ctx.db.plantillaDistribucion` con líneas). Botón "Asignar y siguiente".

- [ ] **Step 4: Nav — item Asignación**

En `app/(app)/[empresaSlug]/layout.tsx`, agregar entre Validación y Movimientos:

```tsx
              { href: `${base}/asignacion`, label: 'Asignación', icono: 'validacion' },
```
(usar un ícono existente; si no hay uno mejor, reusar el de validación.)

- [ ] **Step 5: typecheck + suite completa**

Run: `npm run typecheck && npm test`
Expected: typecheck limpio; suite verde.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(asignacion): cola de Asignación (lista + detalle + asignarAction)"
```

---

## Task 10: Migración en server + verificación end-to-end

**Files:** ninguno (operativo).

- [ ] **Step 1: Deploy a 192.168.44.150**

```bash
cd /home/jdiodati/projects/PNL
rsync -az --exclude='/.git/' --exclude='/node_modules/' --exclude='/.next/' --exclude='/.env' \
  --exclude='/.pgdata/' --exclude='/storage/' --exclude='/Docs/ComprobantesEjemplos/' \
  --exclude='/.superpowers/' --exclude='/.remember/' --exclude='/.claude/' \
  -e 'ssh -o BatchMode=yes' ./ root@192.168.44.150:/opt/pnl-manager/app/
ssh root@192.168.44.150 'chown -R pnl:pnl /opt/pnl-manager/app'
```

- [ ] **Step 2: db push + build + restart (como pnl)**

```bash
ssh root@192.168.44.150 "cd /opt/pnl-manager/app && sudo -u pnl bash -lc 'set -a; source .env; set +a; npx prisma generate && npx prisma db push && npm run build' && systemctl restart pnl-web pnl-worker"
```
Expected: db en sync (rename de columna + nuevas columnas/enum), build OK, servicios active.

- [ ] **Step 3: Verificar el flujo**

Run (consulta): contar por estado en kawellu y confirmar que los 554 siguen en `PENDIENTE_VALIDACION`; validar uno por la UI → `VALIDADO` → aparece en `/asignacion`; asignarlo (categoría + 1 línea 100%) → `ASIGNADO` → aparece en Movimientos con su total. Verificar que Maestros muestra Clientes y Proyectos.

```bash
ssh root@192.168.44.150 "cd /opt/pnl-manager/app && sudo -u pnl bash -lc 'set -a; source .env; set +a; npx tsx -e \"import {PrismaClient} from \\\"@prisma/client\\\"; const p=new PrismaClient(); p.movimiento.groupBy({by:[\\\"estado\\\"],where:{empresa:{slug:\\\"kawellu\\\"}},_count:true}).then(r=>console.log(r)).finally(()=>p.\\\$disconnect());\"'"
```

- [ ] **Step 4: Commit (si hubo ajustes operativos) / cierre**

No requiere commit si solo se verificó. Si el deploy reveló algún fix, commitearlo con `fix(...)`.

---

## Self-Review

**1. Cobertura de la spec:**
- Estados lineales + ASIGNADO → Task 3. ✓
- Cliente/Proyecto split (rename + nuevo master) → Tasks 1, 2, 6. ✓
- Línea = centro + cliente? + proyecto? + % → Tasks 2, 4, 7. ✓
- `validarMovimiento` solo-fiscal + `asignarMovimiento` + regla unificadora → Task 4. ✓
- Cola de Validación solo-fiscal + cola de Asignación → Tasks 8, 9. ✓
- Cierre bloquea por validación/asignación; P&L cuenta ASIGNADO → Task 5. ✓
- Maestros Clientes + Proyectos + nav → Task 6 (+ Asignación nav en Task 9). ✓
- Migración trivial + deploy → Task 10. ✓
- Manuales → ASIGNADO directo (regla unificadora) → Task 4 Steps 5, 7. ✓

**2. Placeholders:** Las Tasks 6/8/9 referencian "clonar el patrón de X" para CRUD/listas casi idénticas a archivos existentes (categorias/validacion) — es seguir el patrón del codebase, con las adaptaciones exactas enumeradas (campos, rutas, queries). El resto tiene código completo.

**3. Consistencia de tipos:** `clienteId`/`proyectoId` usados consistentes en schema (1,2), distribución (2), service (4), editor (7), asignación (9). `puedeAsignar`/`tieneAsignacionCompleta`/`asignarMovimiento`/`DatosAsignacion` definidos en Task 4 y consumidos en 9. `impactaResultado===ASIGNADO` (3) usado en query (5). `bloqueaCierre`/`ESTADOS_BLOQUEAN_CIERRE` (5) en cerrarPeriodo (5).

## Notas / riesgos
- **Orden 7→8→9**: el `DistribucionEditor` se saca de Validación y se usa en Asignación; correr el typecheck al final de la 9 si queda algún call-site intermedio colgado.
- **Rename (Task 1)**: es amplio; el grep del Step 1 es la fuente de verdad de los touch-points. `prisma db push` renombra columnas sin pérdida (tablas sin datos en Kawellu/Ewwo).
- **Contraparte ≠ imputación**: la contraparte (proveedor/cliente fiscal por CUIT) se mantiene en Validación; "Cliente" (dimensión de asignación) es otra cosa y vive en Asignación.
