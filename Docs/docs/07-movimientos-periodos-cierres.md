# 07 — Movimientos, períodos y cierres

## Entidad unificada Movimiento

Comprobantes, asientos manuales y ventas manuales son el **mismo** modelo `Movimiento` con distinto `origen`. Comparten estado, validación, asignación (doc 06), períodos y auditoría. Difieren solo en qué campos de detalle usan y en si tienen archivo/OCR.

### Asiento manual (`origen=ASIENTO_MANUAL`)
- Para lo que no nace de factura de proveedor: **sueldos, cargas sociales, impuestos, ajustes** (el rubro más grande del P&L real).
- Formulario directo: fecha de devengamiento, categoría, distribución (CC + cliente/proyecto), importe (puede ser negativo para ajustes), descripción, adjunto opcional.
- Sin OCR ni checks de comprobante. Nace `PENDIENTE_VALIDACION`, o `VALIDADO` directo si lo crea un Validador/Admin con "validar al guardar".

### Venta manual (`origen=VENTA_MANUAL`)
- Espejo en positivo del comprobante de gasto: cliente (contraparte tipo CLIENTE), tipo de comprobante emitido, punto de venta/número, fecha, neto, IVA, total, categoría de **ingreso**, distribución. Adjunto opcional del PDF emitido.
- Mismos checks aritméticos. La lectura automática de ventas desde ARCA es alcance futuro.

### Plantillas recurrentes
- Definen un asiento tipo (nombre, categoría, importe sugerido, distribución, día del mes).
- Acción **"generar recurrentes del mes"** (botón o Job mensual): crea los asientos en `PENDIENTE_VALIDACION` precargados. El validador ajusta importe si cambió y valida. Caso real: honorarios legales fijos; sueldos por sector trayendo el importe del mes anterior.

## Máquina de estados

```
INGRESADO → PROCESANDO → PENDIENTE_VALIDACION → VALIDADO
                              ↘ RETENIDO (período cerrado)
                              ↘ OBSERVADO (apartado para revisar)
PENDIENTE_VALIDACION/OBSERVADO/RETENIDO → VALIDADO
VALIDADO → ANULADO (motivo obligatorio)
PROCESANDO → ERROR_PROCESAMIENTO (falló OCR; reintentar o cargar a mano)
```
- Solo `VALIDADO` impacta el P&L / totales.
- `ANULADO` nunca se borra; sale de los totales, queda en historial y auditoría.
- Transiciones válidas centralizadas en `lib/movimientos`; rechazar transiciones ilegales.

## Imputación: devengado

- Un movimiento pertenece al mes de su **fecha de devengamiento** (fecha del comprobante), siempre. No hay imputación por pago.

## Períodos y cierres

- Período = mes calendario por empresa, agrupado por ejercicio fiscal según `inicioEjercicioFiscal`.
- Estados `ABIERTO | CERRADO`. **Cerrar** (Validador/Admin) congela el mes: no se puede crear, validar, editar ni anular movimientos con fecha en ese mes.
- **No se puede cerrar** un mes que tenga movimientos `PENDIENTE_VALIDACION`/`OBSERVADO` de ese mes: la pantalla de cierre los lista y exige resolverlos (validar u anular) primero.
- Comprobante con fecha en mes **cerrado** → estado `RETENIDO` + alerta. **Solo un Administrador reabre** el período (acción auditada con motivo); se valida y se vuelve a cerrar. No hay reimputación automática a otro mes.
- Grilla del ejercicio: 12 meses con su estado, totales validados por mes, y acciones de cerrar/reabrir según rol.

## Signo contable (documentar en `lib/movimientos`)
- Categoría `INGRESO` → suma. Categoría `EGRESO` → resta.
- `NOTA_CREDITO_*` sobre compra → suma (reduce gasto). `NOTA_CREDITO_*` sobre venta → resta.
- `NOTA_DEBITO_*` → mismo signo que la factura correspondiente.
- El usuario nunca tipea signos: se derivan de categoría + tipoComprobante.
