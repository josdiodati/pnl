# Autovalidación + Reglas de preasignación — Diseño

**Fecha:** 2026-06-23
**Branch:** `feat/autovalidacion-reglas` (sobre `feat/validacion-asignacion`)
**Estado previo:** Spec A (desacople validación/asignación + Cliente/Proyecto) desplegada en .44.150.

## Objetivo

Reducir el trabajo manual sobre comprobantes de alta confianza:
1. **Autovalidación** — un comprobante que pasa chequeos determinísticos salta `PENDIENTE_VALIDACION` y queda `VALIDADO` (o `ASIGNADO` si una regla da asignación completa), sin intervención humana.
2. **Reglas de preasignación** — un maestro de reglas (condiciones → acción) que, cuando matchea, pre-llena/define la asignación interna (categoría + distribución).

ARCA real (web service) queda **fuera de alcance**: hoy `ARCA_MODE=mock`. La autovalidación NO depende de ARCA; el ancla de confianza es el QR de ARCA/AFIP (que ya es autoritativo en el pipeline) + aritmética. Cuando se integre ARCA real (spec futura), se suma `arcaEstado=VALIDO` como chequeo y la autovalidación corre después de la constatación.

## Decisiones tomadas (con el usuario)

- **Auto-asignar si la regla da todo:** si una regla produce asignación completa (categoría + líneas que suman 100%), el comprobante salta directo a `ASIGNADO` sin paso humano. Si no hay regla completa pero pasa los chequeos → `VALIDADO` y cae en la cola de Asignación (pre-llenada si una regla matcheó parcialmente). Todo es editable después en Movimientos/Asignación.
- **Condiciones de regla v1:** `cargadoPor` (usuario) + `cuit` (emisor) + `canal` + `palabraClave`. Semántica **AND** entre las condiciones que estén seteadas (las nulas no aplican). Una regla sin ninguna condición no matchea nunca (evita reglas "atrapa-todo" accidentales).

## Parte 1 — Reglas de preasignación (se construye primero)

### Modelo `ReglaAsignacion` (empresa-scoped)

```prisma
model ReglaAsignacion {
  id             String   @id @default(cuid())
  empresaId      String
  nombre         String
  prioridad      Int      @default(100) // menor = se evalúa primero
  activa         Boolean  @default(true)
  // Condiciones (AND entre las seteadas; null = no aplica)
  cargadoPorId   String?  // = Movimiento.creadoPorId
  cuit           String?  // CUIT emisor normalizado (= Movimiento.cuitEmisor)
  canal          String?  // WEB|FOTO|EMAIL|TELEGRAM|MANUAL (= Movimiento.canalIngreso)
  palabraClave   String?  // substring case-insensitive
  // Acción
  categoriaId    String?
  distribucionId String?  // PlantillaDistribucion → provee las líneas
  centroCostoId  String?  // alternativa a distribucionId: línea única 100%
  clienteId      String?  // sólo con centroCostoId (línea única)
  proyectoId     String?  // sólo con centroCostoId (línea única)
  empresa        Empresa  @relation(fields: [empresaId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([empresaId, nombre])
}
```

- Sólo `empresa` es relación formal (requiere back-relation `reglasAsignacion ReglaAsignacion[]` en `Empresa`). Los IDs de condición/acción (`cargadoPorId`, `categoriaId`, `distribucionId`, etc.) son `String?` **sin FK**, validados por existencia en el CRUD (mantiene el cambio de schema acotado; mismo criterio que `flags`/`distribucionId` en `PlantillaRecurrente`). Registrar `ReglaAsignacion` en `SCOPED_MODELS` (`lib/empresa/scope.ts`).

### Matching (`lib/reglas/matching.ts`, puro y testeable)

```ts
type EntradaRegla = {
  creadoPorId: string | null;
  cuitEmisor: string | null;     // normalizado
  canalIngreso: string | null;
  texto: string;                  // descripción + razón social emisor, lowercased
};
// AND entre condiciones seteadas; una regla sin condiciones NO matchea.
export function reglaMatchea(regla: ReglaAsignacion, e: EntradaRegla): boolean;
// Primera (menor prioridad, luego createdAt) regla activa que matchea.
export function elegirRegla(reglas: ReglaAsignacion[], e: EntradaRegla): ReglaAsignacion | null;
```

`cuit` se compara normalizado; `palabraClave` con `texto.includes(palabraClave.toLowerCase())`.

### Resolución de la acción → asignación

`lib/reglas/aplicar.ts`: `async resolverAsignacionDeRegla(db, regla) → { categoriaId: string|null, lineas: LineaDistribucion[] }`
- Si `distribucionId` → carga la plantilla y mapea sus líneas (centro/cliente/proyecto/%).
- Si no, y hay `centroCostoId` → una línea `{ centroCostoId, clienteId?, proyectoId?, porcentaje: 100 }`.
- Si no → `lineas: []`.
- `categoriaId` de la regla (o null).
- "Completa" = `tieneAsignacionCompleta(categoriaId, lineas)` (helper existente de Spec A: categoría no nula + líneas que suman 100%).

### CRUD maestro `maestros/reglas`

- Página lista (prioridad, nombre, condiciones resumidas, acción resumida, activa, editar/activar-desactivar).
- Form crear/editar: nombre, prioridad, selects de condición (cargadoPor=miembros de la empresa, cuit=texto o select de contrapartes, canal=enum, palabraClave=texto) y de acción (categoría, distribución **o** centro+cliente+proyecto). Validar: al menos una condición seteada; acción con categoría y (distribución o centro) para poder pre-asignar.
- Actions `guardarRegla`/`toggleRegla` (patrón de `maestros/actions.ts`), con auditoría.
- Nav: item "Reglas" en la sección Maestros (gated `esValidador`).

### Pre-llenado en la cola de Asignación

En `asignacion/[id]/page.tsx`: si el movimiento llega **sin líneas** (no pre-asignado por contraparte ni por el pipeline), evaluar reglas con sus datos y usar la asignación resuelta como `inicial` del `DistribucionEditor` + `defaultValue` de categoría. Es sólo un default editable (la asignación sigue pasando por confirmación humana en este camino). Mostrar un cartelito "Pre-llenado por la regla «X»".

## Parte 2 — Autovalidación (se construye después)

### Chequeos (`lib/autovalidacion.ts`, puro y testeable)

`evaluarAutovalidacion(input) → { apto: boolean, motivos: string[] }` donde apto = TODOS:
1. **QR legible:** `qrEstado === 'OK'`.
2. **Fiscal con CAE:** `esComprobanteFiscalArg === true` && `cae` presente.
3. **Coherencia QR↔extracción:** el QR aportó los campos de encabezado (cuit, total, ptoVta, nro, cae). (En el pipeline el QR ya pisó la extracción; el chequeo confirma que el QR existió y trajo esos campos — si vinieron sólo del LLM, no es apto.)
4. **Aritmética:** `|Σ(netoGravado, iva21, iva105, iva27, percepcionesIva, percepcionesIibb, otrosTributos, noGravadoExento) − total|` ≤ tolerancia `max($1, 0.1% de total)`. Si falta `total` o no hay ningún componente → no apto.
5. **Sin duplicados:** la lista de duplicados está vacía.

`motivos` lista por qué no fue apto (para auditoría/diagnóstico).

### Integración en el pipeline (`procesarExtraccion`, final)

Reemplazar el cálculo de `estadoFinal` (hoy `PENDIENTE_VALIDACION` | `RETENIDO`):
- Si período **cerrado** → `RETENIDO` (igual que hoy; nunca autovalida a período cerrado).
- Si no, y `evaluarAutovalidacion(...).apto`:
  - Resolver asignación: **regla** (primera que matchea) tiene precedencia; si no hay regla, usar los defaults de contraparte (`categoriaDefaultId` + `distribucionDefaultId`) que el pipeline ya aplica.
  - Si la asignación resuelta es **completa** (`tieneAsignacionCompleta`) → `estadoFinal = 'ASIGNADO'`, persistir `categoriaId` + líneas resueltas (pisando las de contraparte si la regla mandó), `validadoPorId = null`.
  - Si no → `estadoFinal = 'VALIDADO'` (y se dejan las líneas/categoría pre-cargadas que correspondan para que la cola de Asignación las muestre).
- Si no es apto → `PENDIENTE_VALIDACION` (igual que hoy).
- `assertTransicion('PROCESANDO', estadoFinal)` debe permitir los nuevos destinos (Spec A ya agregó `PROCESANDO`/`PENDIENTE_VALIDACION`→`VALIDADO`/`ASIGNADO`? verificar en `estados.ts`; si falta `PROCESANDO→VALIDADO`/`ASIGNADO`, agregarlas).
- Auditar: `accion: 'AUTO_VALIDAR'` o `'AUTO_ASIGNAR'` con `motivos`/regla aplicada en `despues` (sin `usuarioId` = acción del sistema). El `accion: 'EXTRAER'` existente queda.

La constatación ARCA (mock) se sigue encolando igual para comprobantes fiscales; no condiciona la autovalidación.

### Invariante

Se relaja formalmente la "validación humana obligatoria" (ya superado el MVP): un comprobante puede llegar a `VALIDADO`/`ASIGNADO` sin humano. Trazabilidad por `AuditLog` (`AUTO_VALIDAR`/`AUTO_ASIGNAR`) y `validadoPorId = null` (UI muestra "automático").

## Testing

- `reglaMatchea`/`elegirRegla`: AND, prioridad, sin-condiciones-no-matchea, normalización de cuit, substring case-insensitive.
- `resolverAsignacionDeRegla`: distribución vs línea única vs vacío; completa vs incompleta.
- `evaluarAutovalidacion`: cada chequeo aislado + caso feliz + tolerancia aritmética (borde).
- Integración pipeline: no rompe el flujo actual; apto+regla-completa → ASIGNADO, apto sin regla → VALIDADO, no-apto → PENDIENTE_VALIDACION, período cerrado → RETENIDO (nunca autovalida).
- Guard de scope: `ReglaAsignacion ∈ SCOPED_MODELS`.

## Fuera de alcance (futuro)

- ARCA real WS (mueve la autovalidación post-constatación + chequeo `arcaEstado=VALIDO`).
- Condiciones por monto/categoría-detectada; reglas con merge multi-match.
- Toggle por empresa para apagar autovalidación (hoy on; chequeos conservadores).
- `porProyecto` en el read-model de Movimientos.
