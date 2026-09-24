# Plan — Cobranzas de ventas (Spec F)

Spec: `docs/superpowers/specs/2026-09-24-cobranzas-design.md`. TDD en la lógica
(funciones puras + integración con la base local); la UI se verifica con
typecheck, build y prueba manual en el server de desarrollo.

## Etapa 0 — Schema
1. Enums + `Cobro` + `CobroAplicacion`; campos en `Movimiento`, `Contraparte`,
   back-relations en `ResumenLinea`. `db push` local.
2. `Cobro` a `SCOPED_MODELS`, `CobroAplicacion` a `RELATION_SCOPE`
   (test de aislamiento).

## Etapa 1 — Saldo y fecha probable
3. `lib/cobranzas/estado.ts` (puro): saldo, estado de cobro, fecha probable con
   fuente, atraso histórico por cliente. Tests.
4. `lib/cobranzas/vencimiento.ts` (puro): leer "Vto. para el pago" del texto.
   Tests con los textos reales. Esquema de extracción + pipeline + mock.
5. `lib/cobranzas/query.ts`: cargar ventas cobrables con aplicaciones y
   contraparte, e histórico por cliente (una sola consulta).
6. Acción `fijarFechaProbable` (+ audit). Plazo por cliente en Maestros.
7. Ventas: columna Cobro, filtro, tarjeta "A cobrar", celda editable.

## Etapa 2 — Registrar cobros
8. `lib/cobranzas/reparto.ts` (puro): FIFO multi-instrumento, retención
   sugerida, cotización implícita, diferencias de cambio. Tests.
9. `lib/cobranzas/service.ts`: `registrarCobro`, `eliminarCobroGrupo`,
   `cerrarSaldoComoRetencion`, `acreditarCheque`, `rechazarCheque`; ajuste de
   cambio (`crearAjusteCambio` / `anularAjuste`). Guardia en `anularMovimiento`.
   Tests de integración.
10. UI: `/ventas/cobro` (form cliente con vista previa), `/ventas/[id]/cobros`.
11. `/cobranzas`: `lib/cobranzas/proyeccion.ts` (puro, tests) + página + nav.

## Etapa 3 — Conciliación
12. `sincronizarCobrosDeLinea` + hooks en conciliar/desvincular/deshacer/
    liberar. Tests de integración (Comnet con retención, USD con ajuste,
    cobro manual confirmado, cheque acreditado).
13. Matching: candidatos por saldo, banda de retención y TC para ventas,
    candidatos de cobros registrados. Tests.

## Cierre
14. `scripts/backfill-cobranzas.ts` idempotente (+ `--dry-run`).
15. Suite completa, typecheck, build; commit por etapa; deploy a pnlvm
    (db push + build + restart); backfill en prod; verificación.
