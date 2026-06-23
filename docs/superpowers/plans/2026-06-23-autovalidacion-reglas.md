# Autovalidación + Reglas de preasignación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Comprobantes de alta confianza se autovalidan (→ VALIDADO, o → ASIGNADO si una regla da asignación completa); un maestro de reglas pre-asigna por condiciones (usuario/CUIT/canal/palabra clave).

**Architecture:** Reglas primero (modelo + matching puro + CRUD + pre-llenado en Asignación), autovalidación después (chequeos puros + integración en el pipeline). ARCA real fuera de alcance.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, vitest. Alias `@/`.

## Global Constraints

- Condiciones de regla v1: `cargadoPorId` + `cuit` + `canal` + `palabraClave`, semántica **AND** entre las seteadas; una regla **sin ninguna condición NO matchea**.
- Precedencia de asignación en autovalidación: **regla** (primera por prioridad asc, luego createdAt) > defaults de contraparte.
- Autovalidación = todos los chequeos: QR `OK` + fiscal-arg con CAE + coherencia QR↔extracción + aritmética (tolerancia `max($1, 0.1%·total)`) + sin duplicados. Período cerrado → `RETENIDO`, nunca autovalida.
- `ReglaAsignacion` es empresa-scoped (registrar en `SCOPED_MODELS`). Acción/condición como `String?` sin FK salvo `empresa`.
- Acciones del sistema (autovalidación) auditan sin `usuarioId` y con `validadoPorId = null`.
- `tieneAsignacionCompleta(categoriaId, lineas)` y `LineaDistribucion` ya existen (Spec A). No duplicar lógica de estados/servicio.

---

### Task 1: Schema `ReglaAsignacion` + scope

**Files:**
- Modify: `prisma/schema.prisma` (nuevo modelo + back-relation en `Empresa`)
- Modify: `lib/empresa/scope.ts` (agregar `'ReglaAsignacion'` a `SCOPED_MODELS`)
- Test: `tests/scope-membership.test.ts` (agregar aserción)

**Interfaces:**
- Produces: modelo `ReglaAsignacion` con campos `id, empresaId, nombre, prioridad(Int @default(100)), activa(Boolean @default(true)), cargadoPorId?, cuit?, canal?, palabraClave?, categoriaId?, distribucionId?, centroCostoId?, clienteId?, proyectoId?, createdAt, updatedAt`, relación `empresa`, `@@unique([empresaId, nombre])`. Delegate `db.reglaAsignacion`.

- [ ] **Step 1: Agregar el modelo al schema**

En `prisma/schema.prisma`, junto a los otros maestros (después de `PlantillaRecurrente`):

```prisma
// Regla de preasignación: condiciones (AND) -> acción (categoría + distribución)
model ReglaAsignacion {
  id             String   @id @default(cuid())
  empresaId      String
  nombre         String
  prioridad      Int      @default(100) // menor = se evalúa primero
  activa         Boolean  @default(true)
  cargadoPorId   String?
  cuit           String?
  canal          String?
  palabraClave   String?
  categoriaId    String?
  distribucionId String?
  centroCostoId  String?
  clienteId      String?
  proyectoId     String?
  empresa        Empresa  @relation(fields: [empresaId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([empresaId, nombre])
}
```

En el modelo `Empresa`, agregar la back-relation (junto a las otras colecciones):

```prisma
  reglasAsignacion ReglaAsignacion[]
```

- [ ] **Step 2: Registrar en SCOPED_MODELS**

En `lib/empresa/scope.ts`, agregar `'ReglaAsignacion',` al Set `SCOPED_MODELS`.

- [ ] **Step 3: Test de scope**

En `tests/scope-membership.test.ts`, agregar:

```ts
it('ReglaAsignacion es empresa-scoped', () => {
  expect(SCOPED_MODELS.has('ReglaAsignacion')).toBe(true);
});
```

- [ ] **Step 4: Generar cliente + verificar**

Run: `npx prisma generate && npm run typecheck && npm test`
Expected: typecheck OK (el delegate `reglaAsignacion` ahora existe), suite verde. (NO correr `db push` acá; va en Task 10.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): modelo ReglaAsignacion + scope"
```

---

### Task 2: Matching puro de reglas

**Files:**
- Create: `lib/reglas/matching.ts`
- Test: `tests/reglas-matching.test.ts`

**Interfaces:**
- Produces: `type EntradaRegla = { creadoPorId: string|null; cuitEmisor: string|null; canalIngreso: string|null; texto: string }`; `reglaMatchea(regla, e): boolean`; `elegirRegla(reglas, e): Regla|null`.
- Consumes: `normalizarCuit` de `@/lib/checks`.

- [ ] **Step 1: Test (fallando)**

`tests/reglas-matching.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reglaMatchea, elegirRegla, type EntradaRegla } from '@/lib/reglas/matching';

const base = { id: 'r', empresaId: 'e', nombre: 'x', prioridad: 100, activa: true,
  cargadoPorId: null, cuit: null, canal: null, palabraClave: null,
  categoriaId: 'c1', distribucionId: null, centroCostoId: 'cc1', clienteId: null, proyectoId: null,
  createdAt: new Date(0), updatedAt: new Date(0) } as any;
const e: EntradaRegla = { creadoPorId: 'u1', cuitEmisor: '30711111118', canalIngreso: 'WEB', texto: 'ypf combustible nafta' };

describe('reglaMatchea', () => {
  it('sin condiciones NO matchea', () => {
    expect(reglaMatchea({ ...base }, e)).toBe(false);
  });
  it('AND de condiciones seteadas', () => {
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1' }, e)).toBe(true);
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1', canal: 'EMAIL' }, e)).toBe(false);
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1', canal: 'WEB' }, e)).toBe(true);
  });
  it('cuit normaliza', () => {
    expect(reglaMatchea({ ...base, cuit: '30-71111111-8' }, e)).toBe(true);
  });
  it('palabraClave case-insensitive substring', () => {
    expect(reglaMatchea({ ...base, palabraClave: 'COMBUSTIBLE' }, e)).toBe(true);
    expect(reglaMatchea({ ...base, palabraClave: 'peaje' }, e)).toBe(false);
  });
  it('regla inactiva nunca participa en elegirRegla', () => {
    expect(elegirRegla([{ ...base, cargadoPorId: 'u1', activa: false }], e)).toBeNull();
  });
  it('elegirRegla devuelve la de menor prioridad', () => {
    const r1 = { ...base, cargadoPorId: 'u1', prioridad: 50, nombre: 'a' };
    const r2 = { ...base, cargadoPorId: 'u1', prioridad: 10, nombre: 'b' };
    expect(elegirRegla([r1, r2], e)?.nombre).toBe('b');
  });
});
```

Run: `npx vitest run tests/reglas-matching.test.ts` → FALLA (módulo inexistente).

- [ ] **Step 2: Implementar**

`lib/reglas/matching.ts`:

```ts
import type { ReglaAsignacion } from '@prisma/client';
import { normalizarCuit } from '@/lib/checks';

export type EntradaRegla = {
  creadoPorId: string | null;
  cuitEmisor: string | null; // normalizado o crudo
  canalIngreso: string | null;
  texto: string; // descripción + razón social, se compara en minúsculas
};

export function reglaMatchea(regla: ReglaAsignacion, e: EntradaRegla): boolean {
  const cond = [regla.cargadoPorId, regla.cuit, regla.canal, regla.palabraClave];
  if (cond.every((c) => c == null || c === '')) return false; // sin condiciones: no matchea
  if (regla.cargadoPorId && regla.cargadoPorId !== e.creadoPorId) return false;
  if (regla.cuit && normalizarCuit(regla.cuit) !== (e.cuitEmisor ? normalizarCuit(e.cuitEmisor) : null)) return false;
  if (regla.canal && regla.canal !== e.canalIngreso) return false;
  if (regla.palabraClave && !e.texto.toLowerCase().includes(regla.palabraClave.toLowerCase())) return false;
  return true;
}

export function elegirRegla(reglas: ReglaAsignacion[], e: EntradaRegla): ReglaAsignacion | null {
  const candidatas = reglas
    .filter((r) => r.activa && reglaMatchea(r, e))
    .sort((a, b) => a.prioridad - b.prioridad || a.createdAt.getTime() - b.createdAt.getTime());
  return candidatas[0] ?? null;
}
```

Run: `npx vitest run tests/reglas-matching.test.ts` → PASA.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(reglas): matching puro (AND condiciones + prioridad)"
```

---

### Task 3: Resolver acción de regla → asignación

**Files:**
- Create: `lib/reglas/aplicar.ts`
- Test: `tests/reglas-aplicar.test.ts`

**Interfaces:**
- Consumes: `LineaDistribucion` de `@/lib/movimientos/distribucion`; `ScopedDb` de `@/lib/empresa/scope`.
- Produces: `async resolverAsignacionDeRegla(db, regla): Promise<{ categoriaId: string|null; lineas: LineaDistribucion[] }>`.

- [ ] **Step 1: Test (fallando)**

`tests/reglas-aplicar.test.ts` — usar un fake `db` con `plantillaDistribucion.findFirst`:

```ts
import { describe, it, expect } from 'vitest';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';

const regBase = { categoriaId: 'cat1', distribucionId: null, centroCostoId: null, clienteId: null, proyectoId: null } as any;

describe('resolverAsignacionDeRegla', () => {
  it('línea única desde centroCostoId', async () => {
    const r = await resolverAsignacionDeRegla({} as any, { ...regBase, centroCostoId: 'cc1', clienteId: 'cl1' });
    expect(r.categoriaId).toBe('cat1');
    expect(r.lineas).toEqual([{ centroCostoId: 'cc1', clienteId: 'cl1', proyectoId: null, porcentaje: 100 }]);
  });
  it('desde plantilla de distribución', async () => {
    const db = { plantillaDistribucion: { findFirst: async () => ({ id: 'd1', lineas: [
      { centroCostoId: 'cc1', clienteId: null, proyectoId: 'p1', porcentaje: '60' },
      { centroCostoId: 'cc2', clienteId: null, proyectoId: null, porcentaje: '40' },
    ] }) } } as any;
    const r = await resolverAsignacionDeRegla(db, { ...regBase, distribucionId: 'd1' });
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[0]).toEqual({ centroCostoId: 'cc1', clienteId: null, proyectoId: 'p1', porcentaje: 60 });
  });
  it('sin distribución ni centro → líneas vacías', async () => {
    const r = await resolverAsignacionDeRegla({} as any, { ...regBase });
    expect(r.lineas).toEqual([]);
  });
});
```

Run: `npx vitest run tests/reglas-aplicar.test.ts` → FALLA.

- [ ] **Step 2: Implementar**

`lib/reglas/aplicar.ts`:

```ts
import type { ReglaAsignacion } from '@prisma/client';
import type { ScopedDb } from '@/lib/empresa/scope';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';

export async function resolverAsignacionDeRegla(
  db: ScopedDb,
  regla: Pick<ReglaAsignacion, 'categoriaId' | 'distribucionId' | 'centroCostoId' | 'clienteId' | 'proyectoId'>,
): Promise<{ categoriaId: string | null; lineas: LineaDistribucion[] }> {
  let lineas: LineaDistribucion[] = [];
  if (regla.distribucionId) {
    const plantilla = await db.plantillaDistribucion.findFirst({
      where: { id: regla.distribucionId },
      include: { lineas: true },
    });
    if (plantilla) {
      lineas = plantilla.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
    }
  } else if (regla.centroCostoId) {
    lineas = [{ centroCostoId: regla.centroCostoId, clienteId: regla.clienteId ?? null, proyectoId: regla.proyectoId ?? null, porcentaje: 100 }];
  }
  return { categoriaId: regla.categoriaId ?? null, lineas };
}
```

Run: `npx vitest run tests/reglas-aplicar.test.ts` → PASA.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(reglas): resolver acción de regla a asignación"
```

---

### Task 4: Maestro CRUD de Reglas + nav

**Files:**
- Create: `app/(app)/[empresaSlug]/maestros/reglas/page.tsx`
- Modify: `app/(app)/[empresaSlug]/maestros/actions.ts` (`guardarRegla`, `toggleRegla`)
- Modify: `app/(app)/[empresaSlug]/layout.tsx` (nav: item "Reglas" en Maestros)

**Interfaces:**
- Consumes: patrón de `maestros/distribuciones/page.tsx` + `maestros/actions.ts` (`volver(slug, ruta, msg)`, `writeAudit`, `DomainError`, `mensaje`).
- Produces: ruta `/maestros/reglas`, actions `guardarRegla(formData)` / `toggleRegla(formData)`.

- [ ] **Step 1: Página lista + form**

`maestros/reglas/page.tsx` (server component, `requireEmpresaPage(slug, 'VALIDADOR')`). Cargar en `Promise.all`: `reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }, { nombre: 'asc' }] })`, `usuarioEmpresa.findMany({ where:{empresaId: ctx.empresa.id}, include:{usuario:true} })` (para el select "cargado por"), `categoria.findMany({where:{activa:true}})`, `plantillaDistribucion.findMany()`, `centroCosto.findMany({where:{activo:true}})`, `cliente.findMany({where:{activo:true}})`, `proyecto.findMany({where:{activo:true}})`, `contraparte.findMany({where:{activa:true}})` (para sugerir CUITs). Soportar `?editar=<id>`.
Form `action={guardarRegla}` con: hidden `empresaSlug` (+ `id` si edita), `nombre` (required), `prioridad` (number, default 100), y:
- Condiciones: select `cargadoPorId` (opción vacía + miembros), input `cuit` (texto libre; placeholder con CUITs de contrapartes), select `canal` (vacío + WEB/FOTO/EMAIL/TELEGRAM/MANUAL), input `palabraClave`.
- Acción: select `categoriaId`, select `distribucionId` (vacío = usar centro abajo), y para línea única: select `centroCostoId`, `clienteId`, `proyectoId`.
Texto de ayuda: "Condiciones: se aplican en conjunto (Y). Dejá vacío lo que no aplique. Acción: elegí categoría y una plantilla de distribución, o un centro de costo (línea única 100%)."
Tabla de listado: prioridad, nombre, condiciones (resumen), acción (resumen), activa, links Editar / Activar-Desactivar (`toggleRegla`).

- [ ] **Step 2: Actions**

En `maestros/actions.ts` agregar (mismo estilo que `guardarPlantillaDistribucion`):

```ts
export async function guardarRegla(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    const prioridad = Number(formData.get('prioridad') ?? 100) || 100;
    const v = (k: string) => { const s = String(formData.get(k) ?? '').trim(); return s || null; };
    const data = {
      nombre, prioridad,
      cargadoPorId: v('cargadoPorId'), cuit: v('cuit'), canal: v('canal'), palabraClave: v('palabraClave'),
      categoriaId: v('categoriaId'), distribucionId: v('distribucionId'),
      centroCostoId: v('centroCostoId'), clienteId: v('clienteId'), proyectoId: v('proyectoId'),
    };
    if (![data.cargadoPorId, data.cuit, data.canal, data.palabraClave].some(Boolean)) {
      throw new DomainError('La regla necesita al menos una condición.');
    }
    if (!data.categoriaId || !(data.distribucionId || data.centroCostoId)) {
      throw new DomainError('La acción necesita categoría y (plantilla de distribución o centro de costo).');
    }
    if (id) {
      const antes = await ctx.db.reglaAsignacion.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Regla inexistente.');
      await ctx.db.reglaAsignacion.update({ where: { id }, data });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: id, accion: 'EDITAR', antes, despues: data });
    } else {
      const nueva = await ctx.db.reglaAsignacion.create({ data: data as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: nueva.id, accion: 'CREAR', despues: data });
    }
  } catch (err) {
    volver(slug, 'reglas', mensaje(err));
  }
  volver(slug, 'reglas');
}

export async function toggleRegla(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const r = await ctx.db.reglaAsignacion.findFirst({ where: { id } });
    if (!r) throw new DomainError('Regla inexistente.');
    await ctx.db.reglaAsignacion.update({ where: { id }, data: { activa: !r.activa } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: id, accion: r.activa ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'reglas', mensaje(err));
  }
  volver(slug, 'reglas');
}
```

(Confirmar que `volver`/`mensaje`/`requireEmpresa`/`writeAudit`/`DomainError` ya están importados en el archivo; si `volver` recibe `(slug, ruta, msg?)`, usar esa firma — copiar el patrón exacto del archivo.)

- [ ] **Step 3: Nav**

En `layout.tsx`, sección "Maestros", agregar después de "Distribuciones":

```tsx
              { href: `${base}/maestros/reglas`, label: 'Reglas', icono: 'distribucion' },
```

- [ ] **Step 4: typecheck + tests + commit**

Run: `npm run typecheck && npm test` → limpio/verde.

```bash
git add -A && git commit -m "feat(maestros): CRUD de Reglas de preasignación + nav"
```

---

### Task 5: Pre-llenado por reglas en la cola de Asignación

**Files:**
- Modify: `app/(app)/[empresaSlug]/asignacion/[id]/page.tsx`

**Interfaces:**
- Consumes: `elegirRegla` (Task 2), `resolverAsignacionDeRegla` (Task 3).

- [ ] **Step 1: Aplicar regla cuando el movimiento no tiene líneas**

En `asignacion/[id]/page.tsx`, después de cargar `mov` (con `lineas`), si `mov.lineas.length === 0` (no pre-asignado), evaluar reglas:
- Cargar `reglas = ctx.db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] })`.
- Construir `EntradaRegla` con `{ creadoPorId: mov.creadoPorId, cuitEmisor: mov.cuitEmisor, canalIngreso: mov.canalIngreso, texto: \`${mov.descripcion ?? ''} ${(mov.extraccionRaw as any)?.razonSocialEmisor ?? ''}\` }`.
- `const regla = elegirRegla(reglas, entrada)`. Si hay regla: `const sugerida = await resolverAsignacionDeRegla(ctx.db, regla)` y usar `sugerida.categoriaId` como `defaultValue` de la categoría y `sugerida.lineas` (mapeadas a `LineaEditor` con strings) como `inicial` del `DistribucionEditor`. Mostrar un aviso "Pre-llenado por la regla «{regla.nombre}» — revisá antes de asignar."
- Si `mov.lineas.length > 0`, comportamiento actual (pre-fill desde las líneas existentes).

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck && npm test` → limpio/verde.

```bash
git add -A && git commit -m "feat(asignacion): pre-llenado por reglas cuando no hay líneas"
```

---

### Task 6: Transiciones PROCESANDO→VALIDADO/ASIGNADO

**Files:**
- Modify: `lib/movimientos/estados.ts`
- Test: `tests/estados.test.ts` (si existe; si no, crear aserción mínima en un test nuevo `tests/estados-autovalidacion.test.ts`)

**Interfaces:**
- Produces: `TRANSICIONES.PROCESANDO` incluye `'VALIDADO'` y `'ASIGNADO'`.

- [ ] **Step 1: Test (fallando)**

```ts
import { describe, it, expect } from 'vitest';
import { puedeTransicionar } from '@/lib/movimientos/estados';
describe('PROCESANDO autovalidación', () => {
  it('permite PROCESANDO→VALIDADO y PROCESANDO→ASIGNADO', () => {
    expect(puedeTransicionar('PROCESANDO', 'VALIDADO')).toBe(true);
    expect(puedeTransicionar('PROCESANDO', 'ASIGNADO')).toBe(true);
  });
});
```

Run el test → FALLA.

- [ ] **Step 2: Agregar transiciones**

En `lib/movimientos/estados.ts`, cambiar la línea de `PROCESANDO`:

```ts
  PROCESANDO: ['PENDIENTE_VALIDACION', 'RETENIDO', 'VALIDADO', 'ASIGNADO', 'ERROR_PROCESAMIENTO'],
```

Actualizar el comentario del header del archivo para mencionar el salto por autovalidación.

Run el test → PASA. `npm test` verde.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(estados): PROCESANDO puede autovalidar a VALIDADO/ASIGNADO"
```

---

### Task 7: Chequeos de autovalidación (puro)

**Files:**
- Create: `lib/autovalidacion.ts`
- Test: `tests/autovalidacion.test.ts`

**Interfaces:**
- Produces: `type EntradaAutoval = { qrEstado: string|null; esComprobanteFiscalArg: boolean; cae: string|null; qrAporto: boolean; importes: Record<string, number|null>; total: number|null; hayDuplicados: boolean }`; `evaluarAutovalidacion(e): { apto: boolean; motivos: string[] }`.

- [ ] **Step 1: Test (fallando)**

```ts
import { describe, it, expect } from 'vitest';
import { evaluarAutovalidacion, type EntradaAutoval } from '@/lib/autovalidacion';

const ok: EntradaAutoval = {
  qrEstado: 'OK', esComprobanteFiscalArg: true, cae: '74100000000000', qrAporto: true,
  importes: { netoGravado: 100, iva21: 21 }, total: 121, hayDuplicados: false,
};

describe('evaluarAutovalidacion', () => {
  it('caso feliz', () => { expect(evaluarAutovalidacion(ok).apto).toBe(true); });
  it('QR no OK → no apto', () => { expect(evaluarAutovalidacion({ ...ok, qrEstado: 'ILEGIBLE' }).apto).toBe(false); });
  it('no fiscal → no apto', () => { expect(evaluarAutovalidacion({ ...ok, esComprobanteFiscalArg: false }).apto).toBe(false); });
  it('sin CAE → no apto', () => { expect(evaluarAutovalidacion({ ...ok, cae: null }).apto).toBe(false); });
  it('QR no aportó → no apto', () => { expect(evaluarAutovalidacion({ ...ok, qrAporto: false }).apto).toBe(false); });
  it('duplicado → no apto', () => { expect(evaluarAutovalidacion({ ...ok, hayDuplicados: true }).apto).toBe(false); });
  it('aritmética fuera de tolerancia → no apto', () => {
    expect(evaluarAutovalidacion({ ...ok, total: 200 }).apto).toBe(false);
  });
  it('aritmética dentro de tolerancia ($1) → apto', () => {
    expect(evaluarAutovalidacion({ ...ok, total: 121.5 }).apto).toBe(true);
  });
  it('sin total → no apto', () => { expect(evaluarAutovalidacion({ ...ok, total: null }).apto).toBe(false); });
});
```

Run → FALLA.

- [ ] **Step 2: Implementar**

`lib/autovalidacion.ts`:

```ts
export type EntradaAutoval = {
  qrEstado: string | null;
  esComprobanteFiscalArg: boolean;
  cae: string | null;
  qrAporto: boolean; // el QR existió y trajo los campos de encabezado
  importes: Record<string, number | null>;
  total: number | null;
  hayDuplicados: boolean;
};

const COMPONENTES = ['netoGravado', 'iva21', 'iva105', 'iva27', 'percepcionesIva', 'percepcionesIibb', 'otrosTributos', 'noGravadoExento'];

export function evaluarAutovalidacion(e: EntradaAutoval): { apto: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (e.qrEstado !== 'OK') motivos.push('QR no legible');
  if (!e.esComprobanteFiscalArg) motivos.push('no es comprobante fiscal argentino');
  if (!e.cae) motivos.push('sin CAE');
  if (!e.qrAporto) motivos.push('el QR no aportó el encabezado');
  if (e.hayDuplicados) motivos.push('posible duplicado');
  if (e.total == null) {
    motivos.push('sin total');
  } else {
    const suma = COMPONENTES.reduce((acc, k) => acc + (e.importes[k] ?? 0), 0);
    const tolerancia = Math.max(1, Math.abs(e.total) * 0.001);
    if (Math.abs(suma - e.total) > tolerancia) motivos.push('la aritmética no cuadra');
  }
  return { apto: motivos.length === 0, motivos };
}
```

Run → PASA.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(autovalidacion): chequeos determinísticos puros"
```

---

### Task 8: Integración en el pipeline

**Files:**
- Modify: `lib/pipeline.ts` (`procesarExtraccion`)
- Test: `tests/pipeline-autovalidacion.test.ts` (test de la lógica de decisión, ver abajo)

**Interfaces:**
- Consumes: `evaluarAutovalidacion` (T7), `elegirRegla` (T2), `resolverAsignacionDeRegla` (T3), `tieneAsignacionCompleta` de `@/lib/movimientos/service`, `validarDistribucion`/`LineaDistribucion`.

- [ ] **Step 1: Calcular estado y asignación de autovalidación**

En `procesarExtraccion`, tras computar `duplicados`, `fechaDevengamiento`, `periodoId` y el `estadoFinal` base (hoy `PENDIENTE_VALIDACION`/`RETENIDO`):

1. Determinar `qrAporto = qrAfip != null`.
2. Si `estadoFinal !== 'RETENIDO'` (período abierto), evaluar:
   ```ts
   const auto = evaluarAutovalidacion({
     qrEstado, esComprobanteFiscalArg: !!extraccion.esComprobanteFiscalArg, cae: caeFinal,
     qrAporto, importes: {
       netoGravado: extraccion.netoGravado ?? null, iva21: extraccion.iva21 ?? null,
       iva105: extraccion.iva105 ?? null, iva27: extraccion.iva27 ?? null,
       percepcionesIva: extraccion.percepcionesIva ?? null, percepcionesIibb: extraccion.percepcionesIibb ?? null,
       otrosTributos: extraccion.otrosTributos ?? null, noGravadoExento: extraccion.noGravadoExento ?? null,
     }, total: totalFinal ?? null, hayDuplicados: duplicados.length > 0,
   });
   ```
3. Resolver asignación (regla > contraparte): si `auto.apto`:
   - `reglas = await db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] })`.
   - `regla = elegirRegla(reglas, { creadoPorId: mov.creadoPorId, cuitEmisor: cuit, canalIngreso: mov.canalIngreso, texto: \`${extraccion.razonSocialEmisor ?? ''} ${mov.descripcion ?? ''}\` })`.
   - Si `regla`: `asign = await resolverAsignacionDeRegla(db, regla)` → `categoriaAuto = asign.categoriaId`, `lineasAuto = asign.lineas`.
   - Si no hay regla: `categoriaAuto = contraparte?.categoriaDefaultId ?? null` y `lineasAuto` = (las de `contraparte.distribucionDefaultId` si existe; reutilizar la carga que ya hace el pipeline más abajo). Para no duplicar, ver Step 2.
4. Decidir:
   - `completa = auto.apto && tieneAsignacionCompleta(categoriaAuto, lineasAuto)` → comprobar con `validarDistribucion` envuelto en try (no tirar): "suma 100" válida.
   - `estadoFinal = completa ? 'ASIGNADO' : auto.apto ? 'VALIDADO' : estadoFinal`.

- [ ] **Step 2: Persistir según el estado**

Unificar el armado de líneas: hoy el pipeline, tras el `update`, crea líneas desde `contraparte.distribucionDefaultId`. Refactor mínimo: calcular las **líneas efectivas** ANTES del `update`:
- Si hubo `regla` con `lineasAuto.length` → usar esas.
- Si no, y `contraparte?.distribucionDefaultId` → las de esa plantilla (mover ese fetch arriba).
Setear en el `update`: `estado: estadoFinal`, `categoriaId: (regla ? categoriaAuto : contraparte?.categoriaDefaultId) ?? null`, `validadoPorId: (estadoFinal === 'VALIDADO' || estadoFinal === 'ASIGNADO') ? null : undefined`. Después del `update`, reemplazar líneas (deleteMany + createMany) con las líneas efectivas (sea por regla o por contraparte). Mantener `assertTransicion('PROCESANDO', estadoFinal)`.

- [ ] **Step 3: Auditoría**

Tras el `update`, además del `accion:'EXTRAER'` existente, si `estadoFinal` es `VALIDADO`/`ASIGNADO`, escribir:
```ts
await writeAudit(db, { entidad: 'Movimiento', entidadId: mov.id,
  accion: estadoFinal === 'ASIGNADO' ? 'AUTO_ASIGNAR' : 'AUTO_VALIDAR',
  despues: { estado: estadoFinal, regla: regla?.nombre ?? null, motivos: auto.motivos } });
```

- [ ] **Step 4: Test de la decisión**

Como `procesarExtraccion` toca DB/IO, testear la **función de decisión** extrayéndola a un helper puro `decidirAutovalidacion({ apto, categoriaId, lineas, estadoBase })` en `lib/autovalidacion.ts` y testeándola: apto+completa→ASIGNADO, apto+incompleta→VALIDADO, no-apto→estadoBase, estadoBase RETENIDO→RETENIDO. (Refactorizar el Step 1/4 para usar ese helper, así queda cubierto sin DB.)

```ts
// en lib/autovalidacion.ts
export function decidirAutovalidacion(p: { apto: boolean; completa: boolean; estadoBase: 'PENDIENTE_VALIDACION'|'RETENIDO' }): string {
  if (p.estadoBase === 'RETENIDO') return 'RETENIDO';
  if (!p.apto) return 'PENDIENTE_VALIDACION';
  return p.completa ? 'ASIGNADO' : 'VALIDADO';
}
```
Test `tests/autovalidacion.test.ts` (agregar): los 4 casos.

Run: `npm run typecheck && npm test` → limpio/verde.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(pipeline): autovalidación + auto-asignación por reglas"
```

---

### Task 9: UI — origen automático y validadoPor nulo

**Files:**
- Modify: `app/(app)/[empresaSlug]/validacion/[id]/page.tsx` y/o `asignacion/[id]/page.tsx` (historial / "validado por")

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Mostrar "automático"**

Donde se muestre `validadoPor` (resumen/historial), si es `null` pero el estado es `VALIDADO`/`ASIGNADO`, mostrar "Automático (sistema)". El historial ya lista los `AuditLog`, así que `AUTO_VALIDAR`/`AUTO_ASIGNAR` aparecen solos; sólo ajustar el rótulo de validadoPor si corresponde. Cambio mínimo y defensivo.

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck && npm test` → limpio/verde.

```bash
git add -A && git commit -m "feat(ui): marcar validación/asignación automática"
```

---

### Task 10: Migración + deploy + verificación en .44.150

**Files:** ninguno (operativo).

- [ ] **Step 1: Pre-check read-only** (tabla `ReglaAsignacion` no existe aún; nada que perder). Confirmar estados actuales.

- [ ] **Step 2: Deploy** (rsync anclado, SIN `--delete`; no hay renames/deletes en esta branch, así que no hay stale dirs). `chown`.

- [ ] **Step 3: Migrar + build + restart**

```bash
ssh root@192.168.44.150 "cd /opt/pnl-manager/app && sudo -u pnl bash -lc 'set -a; source .env; set +a; npx prisma generate && npx prisma db push && npm run build' && systemctl restart pnl-web pnl-worker"
```
Expected: nueva tabla `ReglaAsignacion`, build OK, servicios activos.

- [ ] **Step 4: Verificar**

- `maestros/reglas` responde (307→login sin sesión).
- Crear una regla simple por UI (ej. canal=WEB + palabraClave="test" → categoría X + centro Y) y subir un comprobante de prueba con QR válido → confirmar en logs/DB que queda `VALIDADO` o `ASIGNADO` según la regla; uno sin QR → `PENDIENTE_VALIDACION`.
- Confirmar `AuditLog` con `AUTO_VALIDAR`/`AUTO_ASIGNAR`.

- [ ] **Step 5: Cierre** (commit `fix(...)` sólo si el deploy reveló ajustes).

---

## Self-Review

**Cobertura de la spec:**
- Modelo + scope → Task 1. ✓
- Matching (AND, prioridad, sin-condiciones-no-matchea) → Task 2. ✓
- Acción→asignación (distribución/línea única/vacío) → Task 3. ✓
- CRUD + nav → Task 4. ✓
- Pre-llenado en Asignación → Task 5. ✓
- Transiciones PROCESANDO→VALIDADO/ASIGNADO → Task 6. ✓
- Chequeos autovalidación → Task 7. ✓
- Integración pipeline (regla>contraparte, completa→ASIGNADO, audit sistema) → Task 8. ✓
- UI automático → Task 9. ✓
- Migración/deploy → Task 10. ✓

**Consistencia de tipos:** `EntradaRegla`/`reglaMatchea`/`elegirRegla` (T2) usados en T5/T8; `resolverAsignacionDeRegla` (T3) en T5/T8; `evaluarAutovalidacion`/`decidirAutovalidacion` (T7) en T8; `tieneAsignacionCompleta` (Spec A) en T8.

**Riesgos:** (1) El refactor del armado de líneas en el pipeline (T8 Step 2) es la parte más delicada — mantener el orden assert-antes-de-escribir y no dejar líneas huérfanas. (2) `validadoPorId: undefined` en Prisma = "no tocar"; usar `null` explícito sólo en auto VALIDADO/ASIGNADO. (3) Reglas sin FK: validar existencia de IDs en el CRUD (T4) para no pre-asignar a entidades borradas.
