# Spec A — Desacople Validación/Asignación + dimensiones Cliente/Proyecto (diseño)

Fecha: 2026-06-23
Estado: aprobado para plan de implementación

## Contexto

Post-MVP (ver memoria `direccion-post-mvp`). Hoy la validación de un comprobante
conflaciona dos cosas: confirmar que el comprobante es correcto (fiscal) y asignarlo
internamente (categoría + centro de costo + cliente). `validarMovimiento` exige
categoría + distribución 100% para pasar a `VALIDADO`, y solo `VALIDADO` impacta el P&L.

Se separan en **dos etapas/colas**:
1. **Validación** — correctitud fiscal del comprobante. Manual (o automática en la Spec B).
2. **Asignación** — imputación interna (categoría + centro/cliente/proyecto, con reparto %).

Esta Spec A es la **base estructural**. La autovalidación (Spec B) y el motor de reglas
de preasignación (Spec C) son specs separadas que se apoyan sobre esta.

## Decisiones tomadas

- **Estados lineales** (no flags ortogonales): se agrega `ASIGNADO`. El P&L cuenta `ASIGNADO`.
- **Dimensiones de asignación**: Categoría (obligatoria, **una por comprobante**), Centro de
  Costo (obligatorio), Cliente (opcional), Proyecto (opcional).
- **Reparto por línea**: cada línea de distribución lleva Centro (req) + Cliente? + Proyecto? + %.
  Permite repartir un comprobante entre distintos centros/clientes/proyectos.
- Se separa el actual `ClienteProyecto` en **Cliente** + un master nuevo **Proyecto**.

## Modelo de datos (Prisma)

- **Renombrar `ClienteProyecto` → `Cliente`** (modelo + relaciones + `SCOPED_MODELS`).
  - Campos sin cambio: `id, empresaId, nombre, codigo?, activo`. `@@unique([empresaId, nombre])`.
- **Nuevo master `Proyecto`**: `id, empresaId, nombre, codigo?, activo`, `@@unique([empresaId, nombre])`.
  Agregado a `SCOPED_MODELS`.
- **`MovimientoLinea`**: reemplazar `clienteProyectoId` por `clienteId String?` + `proyectoId String?`
  (ambos opcionales). Mantener `centroCostoId` (req) y `porcentaje`. Relaciones a `Cliente` y `Proyecto`.
- **`PlantillaDistribucionLinea`**: mismo reemplazo (`clienteId?` + `proyectoId?`).
- **`Movimiento`**: agregar valor `ASIGNADO` al enum `EstadoMovimiento`. `categoriaId` sin cambios
  (una por comprobante). `RELATION_SCOPE` para `MovimientoLinea`/`PlantillaDistribucionLinea` sin cambios.
- Migración con `prisma db push` (la base de dev/test no tiene líneas ni plantillas en Kawellu/Ewwo;
  los 554 están en `PENDIENTE_VALIDACION` sin líneas → no hay datos que migrar, solo schema).

## Máquina de estados (`lib/movimientos/estados.ts`)

```
INGRESADO → PROCESANDO → PENDIENTE_VALIDACION → VALIDADO → ASIGNADO
                              ↘ RETENIDO (período cerrado)
                              ↘ OBSERVADO (apartado)
PENDIENTE_VALIDACION / OBSERVADO / RETENIDO → VALIDADO
VALIDADO → ASIGNADO | ANULADO
ASIGNADO → VALIDADO (des-asignar para corregir) | ANULADO
PROCESANDO → ERROR_PROCESAMIENTO
```

- `TRANSICIONES`: agregar `VALIDADO: ['ASIGNADO','ANULADO']` y `ASIGNADO: ['VALIDADO','ANULADO']`.
- `impactaResultado(estado)` → `estado === 'ASIGNADO'`.
- `ESTADO_LABEL.ASIGNADO = 'Asignado'`.
- `ESTADOS_INICIALES`: los manuales (`ASIENTO_MANUAL`/`VENTA_MANUAL`) hoy pueden nacer `VALIDADO`
  directo; con el desacople, un manual validado-directo igual necesita asignación. Se mantienen
  naciendo en `PENDIENTE_VALIDACION` o `VALIDADO` (no `ASIGNADO`); la asignación es paso aparte.

## Capa de servicio (`lib/movimientos/service.ts`)

- **`validarMovimiento`** deja de exigir/escribir categoría y líneas. Solo valida lo fiscal
  (fecha, total, gate de ARCA/override existente) y transiciona `→ VALIDADO`. Mantiene la
  persistencia de `instruccionesExtraccion` en la contraparte. Audita `VALIDAR`.
- **Nuevo `asignarMovimiento(ctx, id, { categoriaId, lineas[] })`**:
  - Exige `categoriaId` válida (de la empresa) y distribución que sume 100% (reusar
    `validarDistribucion`); valida que cada `centroCostoId`/`clienteId`/`proyectoId` pertenezca a la empresa.
  - Solo aplica a estado `VALIDADO` (o re-asignar desde `ASIGNADO`). Período debe estar abierto.
  - Reemplaza líneas, setea `categoriaId`, transiciona `→ ASIGNADO`. Audita `ASIGNAR`.
- `reemplazarLineas` se adapta al nuevo shape de línea (cliente/proyecto).
- `crearMovimientoManual` (asiento/venta manual): estos se cargan **con su imputación en el mismo
  form** (categoría + distribución), así que **no pasan por la cola de Asignación**:
  - creado por validador+ con `validarAlGuardar` → directo a `ASIGNADO`.
  - creado por cargador → `PENDIENTE_VALIDACION`; al validarse, como ya trae imputación, pasa a `ASIGNADO`.
  - Regla unificadora: `validarMovimiento` transiciona a `ASIGNADO` si el movimiento ya tiene
    categoría + líneas que suman 100%; si no (caso de los comprobantes capturados), a `VALIDADO`.
  - La **cola de Asignación es para los comprobantes capturados** (`COMPROBANTE`/`VENTA_COMPROBANTE`)
    que llegan sin imputar.

## Colas y UI

- **Cola de Validación** (`/validacion`, existente): se mantiene; el formulario de detalle
  (`components/validacion-form.tsx`) **pierde** los campos de imputación (categoría, centro,
  cliente, distribución). Queda enfocado en lo fiscal (fechas, importes, contraparte, ARCA, override).
  "Validar y siguiente" pasa a `VALIDADO`.
- **Cola de Asignación** (`/asignacion`, nueva): lista los `VALIDADO` (no asignados), ordenada
  por antigüedad. Pantalla de asignación: selector de Categoría + **editor de distribución**
  (líneas Centro + Cliente? + Proyecto? + %), con "Asignar y siguiente" → `ASIGNADO`.
- `DistribucionEditor` (`components/`): adaptar de `clienteProyecto` a Cliente + Proyecto (dos selects).
- **Sidebar**: agregar item "Asignación" (entre Validación y Movimientos). En Maestros, reactivar
  con dos secciones: **Clientes** y **Proyectos** (reemplaza el link comentado de Clientes/Proyectos).
- **Dashboard de carga**: la tarjeta/estado puede sumar el conteo de "pendientes de asignación"
  (opcional, decidir en el plan).

## Cierre de período y P&L

- `cerrarPeriodo`: bloquear si en el mes hay movimientos en `PENDIENTE_VALIDACION`, `OBSERVADO`,
  `RETENIDO` **o `VALIDADO`** (validado pero sin asignar). Solo cierra con todo `ASIGNADO`/`ANULADO`.
  El mensaje de error lista qué falta y de qué tipo (validar vs asignar).
- `movimientos/query.ts`, pantalla de Movimientos, Ventas y export CSV: el P&L/totales cuentan
  `ASIGNADO` (vía `impactaResultado`). Revisar filtros que hoy usan `VALIDADO` para "impacta".

## No incluye (otras specs)

- Autovalidación (QR + aritmética + ARCA) → Spec B.
- Motor de reglas de preasignación → Spec C.
- ARCA WS real → (D), requiere certificado AFIP.
- Persona/empleado como dimensión propia → a decidir más adelante (hoy se modela en la categoría).

## Testing

- Unit (`vitest`): nuevas transiciones (`VALIDADO↔ASIGNADO`, `ASIGNADO→ANULADO`),
  `impactaResultado === 'ASIGNADO'`, `asignarMovimiento` (suma 100%, pertenencia a empresa,
  estado de origen válido), gate de cierre (no cierra con `VALIDADO` sin asignar).
- La suite de aislamiento multiempresa existente debe seguir verde con `Cliente`/`Proyecto`.

## Criterios de aceptación

1. Validar un comprobante lo deja en `VALIDADO` sin pedir categoría/centro; aparece en la cola de Asignación.
2. Asignar (categoría + distribución 100% con centro/cliente/proyecto por línea) lo pasa a `ASIGNADO`;
   recién ahí impacta Movimientos/P&L.
3. Cliente y Proyecto son maestros separados; una línea puede tener cliente y proyecto distintos a otra.
4. No se puede cerrar un mes con comprobantes `VALIDADO` sin asignar (los lista).
5. `ASIGNADO → VALIDADO` permite des-asignar y re-asignar; `ANULADO` sale de los totales.
6. Maestros muestra Clientes y Proyectos; la app corre end-to-end (deploy a 192.168.44.150).

## Deploy / entorno

- Server dev/test: `192.168.44.150` (ver memoria `servidor-dev-pnl`). Deploy por rsync, `prisma db push`
  aditivo (enum + columnas), build, restart servicios.
