# 06 — Asignación a centros de costo y dimensiones

Junto con la captura, es lo más importante del MVP. La planilla actual solo permite imputar un movimiento a un único centro; acá habilitamos **dos dimensiones** y **reparto porcentual**.

## Dos dimensiones de análisis por movimiento

Cada movimiento se reparte en 1..N **líneas de asignación**. Cada línea tiene:
- `centroCostoId` — **obligatorio** (BPO, SF, Administración, ...).
- `clienteProyectoId` — **opcional** (un alquiler no tiene cliente; un costo directo de la cuenta Telecom sí).
- `porcentaje` — con 2-4 decimales.

La suma de los `porcentaje` de un movimiento debe ser **exactamente 100**. Validar en la capa de servicio y ajustar el redondeo del último renglón para que los importes derivados por línea sumen exacto el total.

El **importe de cada línea** se deriva: `importeLinea = totalFirmado * porcentaje / 100`, donde `totalFirmado` aplica el signo contable (egreso negativo, ingreso positivo, notas de crédito invertidas).

## UI de asignación

- Por defecto: **un renglón, un centro de costo, 100%**, sin cliente/proyecto. Lo mínimo para no entorpecer la carga rápida.
- Botón **"dividir"**: agrega renglones. Cada renglón = centro de costo + (opcional) cliente/proyecto + porcentaje. Mostrar **en vivo** el importe que cae en cada renglón y un indicador de cuánto falta para llegar a 100%. No dejar validar si no suma 100.
- Atajos: "repartir en partes iguales", y aplicar una **plantilla de distribución** con un click.

## Plantillas de distribución

- Definidas a nivel empresa: nombre + N líneas (centro de costo, cliente/proyecto opcional, porcentaje). Ej.: "Alquiler oficina → 60% BPO / 30% SF / 10% Administración".
- Se pueden aplicar en cualquier movimiento y asignar como **default de una contraparte** (toda factura de ese proveedor llega con esa distribución precargada).

## Clasificación automática (alcance MVP)

- Por **contraparte**: al matchear el CUIT, se proponen `categoriaDefault` + `distribucionDefault`. El validador confirma o cambia.
- Reglas más sofisticadas (por categoría, por monto, en cascada) quedan **fuera del MVP** pero el modelo no debe impedirlas a futuro.

## Nota de diseño para el futuro (no construir ahora)

El reparto porcentual manual de hoy es el insumo del **motor de prorrateos automático** de la próxima etapa (seat cost por headcount, OH/Admin burden). No construir ese motor todavía, pero al modelar las líneas de asignación pensá que más adelante habrá asignaciones **generadas por reglas** además de las manuales: conviene un campo o flag que permita distinguir el origen de una línea/movimiento (manual vs. generado por prorrateo) cuando llegue el momento, sin tener que migrar datos.
