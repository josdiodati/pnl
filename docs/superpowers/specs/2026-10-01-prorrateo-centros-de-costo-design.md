# Prorrateo de centros de costo — diseño

Fecha: 2026-10-01 · Estado: aprobado en conversación (el usuario pidió implementar y desplegar sin más revisiones)

## Objetivo

Que los centros de costo de costos indirectos (en Ewwo, "Seat Cost", que puede
renombrarse) se repartan a los demás centros en el Reporte P&L por centro de
costo, para ver el resultado **totalmente cargado** de cada línea de negocio
junto al resultado de contribución (antes de prorrateos).

## Decisiones

| # | Decisión |
|---|----------|
| D1 | El atributo es del centro (no del nombre): `prorrateo` = vacío / `HEADCOUNT` / `FACTURACION`. Enum extensible. |
| D2 | **Método directo**: un centro prorrateable nunca recibe prorrateos. Los denominadores excluyen a TODOS los centros prorrateables (no sólo al emisor) — sin ciclos ni orden. Ej. sep-2026 Ewwo: 13 cabezas, Seat Cost 1 → base 12, BPO recibe 7/12. Si Administración (2) fuera prorrateable, base 10 y BPO 7/10. |
| D3 | Se reparte el **resultado completo del mes** del emisor en la vista por centro (ingresos, egresos, sueldos, prepagas; sin memo de impuestos) — el mismo número que muestra el P&L filtrado por ese centro. |
| D4 | Driver **headcount**: por empleado y mes, la distribución de su recibo MENSUAL CONFIRMADO; si no lo tiene (aún sin confirmar), la de su **ficha de asignación** mientras el empleado corresponda al mes (ingresó antes de fin de mes, no egresó antes del mes; inactivo sin fecha de egreso no cuenta). Ponderado por porcentaje (60/40 suma 0,6 y 0,4); los porcentajes asignados a centros prorrateables se descartan. |
| D5 | Driver **facturación**: ventas ASIGNADAS del mes (categoría INGRESO, no impuesto indirecto), base neta en pesos (misma `baseImponibleFirmada` del P&L: NC restan, moneda extranjera × TC, sin TC no cuenta), repartida por las líneas. Un centro con facturación neta negativa en el mes cuenta 0. |
| D6 | Driver total del mes = 0 → no se reparte; el monto queda en el emisor y la vista lo marca "sin base de prorrateo". |
| D7 | Reparto al centavo por mayor resto: la suma de lo recibido = lo repartido, exacto. |
| D8 | Es capa de reporte (query-time), no asientos: Movimientos no cambia. Cambiar la marca recalcula también meses pasados (aceptado; foto al cierre = etapa futura). |
| D9 | Se muestra **sólo en la vista por centro de costo**. P&L completo, vistas por proyecto/cliente y "sin distribución" no cambian (el prorrateo suma cero en el total). |

## Presentación (vista por centro)

Debajo de "RESULTADO DEL PERÍODO" (que pasa a llamarse "Resultado antes de
prorrateos" cuando la sección aplica):

- **Receptor**: sección "Prorrateos recibidos", una fila por emisor
  ("Seat Cost · por headcount"), celdas con tooltip de la fracción
  ("7 / 12 headcount") y link a la vista del emisor.
- **Emisor**: fila "Repartido a otros centros (por headcount)" = −monto
  repartido; meses sin base muestran "—" con tooltip "sin base de prorrateo".
- "Resultado después de prorrateos" + su % de margen.
- La sección no aparece si no hay centros prorrateables o si la vista no
  recibe/reparte nada en el ejercicio.

Maestros → Centros de costo: selector "Prorrateable: No / Por headcount / Por
facturación" y etiqueta en la lista.

## Componentes

- `prisma/schema.prisma`: `enum CriterioProrrateo { HEADCOUNT FACTURACION }`,
  `CentroCosto.prorrateo CriterioProrrateo?` (aditivo, nullable).
- `lib/reportes/prorrateo.ts` (puro, testeable):
  - `headcountPorCentro({ meses, recibos, empleados })` → `Map<centroId, number[]>`.
  - `facturacionPorCentro({ meses, movimientos })` → `Map<centroId, number[]>` (centavos).
  - `repartirProporcional(total, pesos)` → centavos enteros por mayor resto.
  - `calcularProrrateos({ meses, centros, resultadoEmisor, drivers })` →
    `{ recibidos: Map<receptor, Map<emisor, number[]>>, repartido: Map<emisor, number[]>, fraccion: … , sinBase: Map<emisor, boolean[]> }`.
- `app/(app)/[empresaSlug]/reportes/page.tsx`: en vista `cc:<id>` con
  centros prorrateables, carga empleados + fichas, arma drivers, resultado
  por emisor (`armarPnl` filtrado por cada emisor) y pinta la sección.
- Maestros: `guardarCentroCosto` persiste `prorrateo`; página con selector.

## Pruebas

Unitarias de `prorrateo.ts`: ejemplo 13→12→7/12; directo con dos emisores
(base 10); fallback a ficha y egresado que no cuenta; asignación parcial al
emisor descartada; driver total 0 (sin base); facturación con centro
negativo; reparto cierra al centavo; invariante Σ(después de prorrateos de
todos los centros) + sin centro = total.

## Fuera de alcance

Método escalonado/recíproco, prorrateo en vistas por proyecto/cliente, foto
de drivers al cierre, facturación acumulada del ejercicio como driver.
