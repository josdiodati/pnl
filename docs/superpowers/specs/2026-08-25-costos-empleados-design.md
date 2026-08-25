# Spec D — Costos de empleados (recibos de sueldo) (diseño)

Fecha: 2026-08-25
Estado: aprobado para plan de implementación

## Contexto

Cada empresa liquida sueldos y el recibo concentra casi todo el costo de un empleado.
Ewwo entrega un único PDF mensual con un recibo por página (13 empleados en el de
agosto 2026, `Docs/RecibosSueldoEwwo/`). El recibo de Ewwo ya imprime el
**COSTO TOTAL EMPLEADOR** (bruto remunerativo + no remunerativo + contribuciones
patronales: Seg. Social 18,9%, Obra Social 5,1%, ART, SCVO). Otros modelos de recibo
(otras empresas) pueden no imprimirlo; la extracción debe ser agnóstica del formato.

Existen costos del empleado **fuera del recibo**: el caso concreto es la prepaga
cuando la empresa absorbe la diferencia entre el plan y los aportes/contribuciones de
obra social. Esas facturas ya entran hoy al sistema como comprobantes.

### Decisiones tomadas con el usuario

- **Impacta el P&L**: el costo por período entra distribuido por centro de
  costo/cliente/proyecto junto con los comprobantes.
- **Ingesta**: PDF multi-recibo subido en la sección Empleados; split por página y
  extracción automática con LLM. Sólo canal web (no email/telegram).
- **Costos extra-recibo**: se vinculan comprobantes existentes a empleados (montos
  por empleado), evitando el doble conteo. Sin conceptos manuales sueltos.
- **Sin provisión de SAC/vacaciones**: el costo del período es lo que dicen los
  recibos reales. Junio/diciembre saltan y está bien: el dato es real.
- **Distribución fija por empleado**: se define en la ficha y cada recibo nuevo la
  hereda; un recibo puntual puede ajustarse sin tocar la ficha.
- **Sólo ADMINISTRADOR** ve la sección y el detalle por empleado. El resto de los
  roles ve únicamente el agregado "Costos de personal" en los resúmenes del libro.

### Enfoque elegido (A)

Módulo propio (`Empleado` + `ReciboSueldo` + distribución propia), consolidado en el
proto-P&L (vista Movimientos) **a tiempo de query** — nada materializado, nada que
sincronizar. Se descartó convertir recibos en `Movimiento` (modelo con forma de
factura: CUIT emisor, CAE, IVA, ARCA y duplicados por QR no aplican; y el detalle
salarial quedaría visible para todos los roles en el libro).

## Modelo de datos (Prisma)

Todos los modelos nuevos entran a `SCOPED_MODELS` / `RELATION_SCOPE` según
corresponda (aislamiento multi-empresa como el resto).

- **`Empleado`**: `id, empresaId, nombre, cuil, legajo?, categoria?, sector?,
  fechaIngreso?, fechaEgreso?, activo`. `@@unique([empresaId, cuil])` — el CUIL es la
  clave de matching en la ingesta. Relaciones: `distribucion`, `recibos`, `vinculos`.
- **`EmpleadoDistribucionLinea`**: `empleadoId, centroCostoId, clienteId?,
  proyectoId?, porcentaje Decimal(7,4)` (suman 100). Mismo shape que
  `MovimientoLinea`/`PlantillaDistribucionLinea`.
- **`ReciboSueldo`**:
  - `id, empresaId, empleadoId, periodoId, tipo, estado`.
  - `tipo` enum `TipoRecibo`: `MENSUAL | SAC | VACACIONES | LIQUIDACION_FINAL | OTRO`.
  - `@@unique([empresaId, empleadoId, periodoId, tipo])` — guarda anti-duplicado; en
    junio conviven MENSUAL y SAC sin pisarse.
  - Totales `Decimal(18,2)`: `brutoRemunerativo`, `noRemunerativo`, `retenciones`,
    `sueldoNeto`, `contribucionesEmpleador`, **`costoTotalEmpleador`** (la cifra que
    va al P&L).
  - `conceptos Json`: lista `{concepto, unidad?, remunerativo?, retencion?, noRem?}`
    + contribuciones patronales. JSON flexible: otro modelo de recibo no exige
    migración de schema.
  - Archivo: `archivoKey, archivoNombre, archivoMime, pagina` (el PDF completo se
    guarda una sola vez; cada recibo apunta a su página).
  - Extracción: `extraccionRaw Json?`, `camposRevisar Json?`, `confianza Json?`,
    `tokensEntrada?/tokensSalida?` (mismo monitoreo de costo LLM que Movimiento).
  - `estado` enum `EstadoRecibo`: `PROCESANDO | PENDIENTE_REVISION | CONFIRMADO |
    ANULADO | ERROR_PROCESAMIENTO`. `nota String?` para el motivo de anulación
    (p. ej. duplicado) o advertencias de ingesta.
- **`ReciboDistribucionLinea`**: mismo shape; al **confirmar** el recibo se **copia**
  la distribución vigente de la ficha (editable sólo en ese recibo). Copia, no
  referencia: cambiar la ficha no reescribe historia.
- **`MovimientoEmpleado`** (vínculo comprobante→empleado): `movimientoId, empleadoId,
  monto Decimal(18,2)`. `@@unique([movimientoId, empleadoId])`. Montos y no
  porcentajes: una factura única de prepaga reparte importes distintos entre varios
  empleados y el remanente sigue siendo gasto general. Restricción: la suma de
  vínculos de un movimiento no supera su total.
- Migración aditiva con `prisma db push`.

## Ingesta y extracción

1. **Upload** en la sección Empleados (admin): PDF multi-recibo → storage (una vez)
   → split por página → un `Job` tipo `EXTRACCION_RECIBO` por página (mismo worker,
   misma política de reintentos; `lib/pipeline.ts` gana `procesarExtraccionRecibo`).
2. **Extractor** (`lib/extractor`, prompt/schema propio de recibos, agnóstico del
   formato): devuelve empleado (`nombre, cuil, legajo, categoria, sector,
   fechaIngreso`), `periodo` (de "Periodo abonado"), `tipo`, `conceptos`, totales y
   `costoTotalEmpleador` si figura. Si el recibo no lo imprime → se calcula
   `bruto + noRem + contribuciones` y el campo queda flaggeado REVISAR.
3. **Matching por CUIL** contra `Empleado`; si no existe se crea la ficha con los
   datos del recibo, sin distribución. Si el recibo trae datos maestros distintos a
   la ficha (categoría, sector), se flaggea para revisar, no se pisa en silencio.
4. **Control aritmético** (misma filosofía que la autovalidación de comprobantes),
   con tolerancia de redondeo (concepto "Redondeo" en Ewwo):
   - `sueldoNeto = brutoRemunerativo − retenciones + noRemunerativo`
   - `costoTotalEmpleador = brutoRemunerativo + noRemunerativo + contribucionesEmpleador`
5. **Estados resultantes**:
   - Aritmética cierra + empleado existente con distribución completa →
     **CONFIRMADO directo** (hereda y copia la distribución de la ficha). Caso feliz:
     subís el PDF y los 13 quedan listos.
   - Empleado nuevo / sin distribución / aritmética que no cierra →
     **PENDIENTE_REVISION** con campos flaggeados.
   - Ya existe `(empleado, período, tipo)` → el nuevo no pisa nada y queda apartado
     como duplicado (ANULADO con motivo, visible en la ficha).
6. **Período**: `getOrCreatePeriodo` con el período del recibo. Si el período está
   cerrado → el recibo queda PENDIENTE_REVISION con advertencia (no entra a un mes
   cerrado).

## Sección Empleados (UI)

- **Sidebar**: entrada "Empleados" sólo visible para ADMINISTRADOR; guarda
  server-side (`rolAlcanza(rol, 'ADMINISTRADOR')`) en todas las pages y actions —
  primera sección con restricción por rol.
- **`/[empresa]/empleados`** (selector de período, como Movimientos):
  - KPIs: costo total de personal del período, empleados con recibo, pendientes.
  - Tabla: empleado, categoría/sector, recibos + vinculados = costo total del
    período, estado (✔ confirmado / ⏳ pendiente / — sin recibo). "Sin recibo" es el
    checklist mensual gratis.
  - Botón **"Subir recibos"** con progreso por página (jobs) y listado incremental.
  - Pestaña **"Pendientes"**: página del PDF a la izquierda, campos editables a la
    derecha (patrón Validación), distribución pre-cargada desde la ficha.
    Confirmar → CONFIRMADO.
- **`/[empresa]/empleados/[id]`** (ficha):
  - Datos editables + **distribución por defecto** (reutiliza `DistribucionEditor`).
  - Historial por período: mensual / SAC / vinculados / costo total.
  - Recibos con visor de la página correspondiente (`DocViewer` existente).
  - Comprobantes vinculados: lista + "Vincular comprobante" (buscador de
    movimientos; monto por empleado; un movimiento puede repartirse entre varios).
- Gráfico de evolución: diferido (la tabla por período responde la pregunta).

## Integración P&L y cierre

- **`resumirCostosPersonal(empresaId, filtros de período)`** (`lib/empleados/`):
  agrega por centro de costo/cliente/proyecto los recibos CONFIRMADOS (vía
  `ReciboDistribucionLinea`) más las porciones vinculadas de movimientos en estado
  **ASIGNADO** — el mismo criterio del libro: un comprobante vinculado pero anulado o
  aún no asignado no computa — (vía la distribución de la ficha del empleado, a
  tiempo de query).
- **Vista Movimientos**: suma un bloque **"Costos de personal"** en totales y
  desglose — un solo agregado, sin detalle por empleado, visible para todos los
  roles. El CSV export incluye el agregado como línea, no por empleado.
- **Sin doble conteo**: un comprobante vinculado aparece una sola vez en el libro,
  entero, con indicador "vinculado a empleados". En los resúmenes aporta
  `total − Σ montos vinculados` según sus propias líneas; lo vinculado computa dentro
  de "Costos de personal" según la distribución del empleado.
- **Cierre de período**: congela recibos y vínculos del período (sin editar ni
  anular; misma regla que movimientos). Recibos PENDIENTE_REVISION no bloquean el
  cierre pero se listan como advertencia.
- **Auditoría**: alta/confirmación/anulación de recibos y alta/baja de vínculos via
  `writeAudit` existente.

## Testing

Sobre los 174 verdes actuales:

- **Unit**: control aritmético con tolerancia (fixtures del PDF real de Ewwo:
  caso estándar, media jornada — Aranda, adelantos — Frontera), matching por CUIL,
  transiciones de estado de recibo, copia de distribución al confirmar, guarda
  anti-duplicado `(empleado, período, tipo)`.
- **Consolidación**: `resumirCostosPersonal` y no-doble-conteo con un comprobante
  parcialmente vinculado.
- **Autorización**: no-admin no ve la sección ni puede ejecutar las actions.
- **Cierre**: recibo/vínculo de período cerrado rechaza edición.
- **E2e en dev** (192.168.44.150): subir el PDF real (13 recibos) y verificar los 13
  `costoTotalEmpleador` contra los valores conocidos del PDF.

## Fuera de alcance (por ahora)

- Provisión de SAC/vacaciones (vista normalizada).
- Conceptos manuales extra-recibo (todo entra por recibo o comprobante vinculado).
- Ingesta de recibos por email/telegram.
- Gráfico de evolución de costo por empleado.
- Reportes P&L formales (placeholder existente): cuando se construyan, consumen
  `resumirCostosPersonal` ya diseñado.
