# Spec E — Resúmenes de tarjeta y banco + conciliación (diseño)

Fecha: 2026-08-27
Estado: aprobado en conversación; pendiente de review escrito

## Contexto

El P&L de la app quedó a ~$3,4M del Excel de julio en el que el usuario confía.
La brecha son gastos SIN comprobante: impuestos bancarios (Sircreb, imp.
débito/créditos), comisiones de cuenta, seguros por débito automático y
suscripciones de tarjeta (Starlink, Slack, OpenAI, etc.). La fuente documental
de todos ellos es el RESUMEN (de tarjeta de crédito o de cuenta bancaria).

Además existe el riesgo inverso: gastos que SÍ tienen comprobante (ej. el PDF
no fiscal de Anthropic) y que también aparecen como línea del resumen — si la
línea se imputara de nuevo, el gasto quedaría duplicado.

### Decisiones tomadas con el usuario

- Sección nueva **Registros → Resúmenes**: portal de resúmenes de tarjeta y
  banco — subirlos, ver los anteriores, y conciliar sus líneas.
- La **línea del resumen es el análogo del comprobante**: se captura por
  extracción y se le asigna categoría + centro/cliente/proyecto.
- **Matching automático línea ↔ movimiento existente** para proponer
  conciliaciones y evitar duplicados; lo no matcheado (o dudoso) se imputa
  tomando la línea como base del gasto.
- Un gasto imputado desde una línea **nace directo ASIGNADO** (mini-form con
  categoría + distribución en el acto): el resumen es el respaldo documental.
- **Tarjeta y banco desde el día uno** (modelo y UI únicos; un extractor que
  entiende ambos formatos).
- UI intuitiva y visual: bandeja de conciliación con estados por color,
  progreso del resumen y control de completitud.

## Modelo de datos (Prisma)

Modelos scoped por empresa (`SCOPED_MODELS` / `RELATION_SCOPE` como el resto).

- **`Resumen`**: `id, empresaId, tipo` (enum `TipoResumen: TARJETA | BANCO`),
  `emisor` (texto: "VISA Santander", "Cuenta Frances"), `periodoId` (mes al
  que corresponde), `fechaCierre?`, `totalDeclarado Decimal?` (el total que
  imprime el resumen, para el control de completitud), `archivoKey/Nombre/
  Mime/Hash` (hash para avisar re-subidas del mismo archivo), `estado`
  (`PROCESANDO | EXTRAIDO | ERROR_PROCESAMIENTO`), metadatos de extracción
  (`extraccionRaw, tokens*, modeloExtractor`), `createdAt`.
- **`ResumenLinea`**: `id, resumenId, orden Int, fecha DateTime?, descriptor
  String` (tal como viene), `monto Decimal(18,2)` (FIRMADO: gastos negativos,
  créditos positivos), `moneda` (`ARS|USD|EUR|OTRA`), `montoOrigen Decimal?`
  (el importe en moneda origen cuando el resumen muestra ambos; TC implícito
  = |monto| / |montoOrigen|), `cuotas String?` ("3/6"),
  `estado` (enum `EstadoLineaResumen: PENDIENTE | SUGERIDA | CONCILIADA |
  IMPUTADA | IGNORADA`), `movimientoId String?` (el movimiento conciliado o
  el creado al imputar), `candidatos Json?` (ids+score del matching, para el
  panel), `motivoIgnorada String?`, `createdAt`.
  - Relación-scope vía `resumen.empresaId`. `Movimiento` gana back-relation
    `lineasResumen ResumenLinea[]`.
- **`Contraparte.descriptoresResumen Json?`**: lista de descriptores
  aprendidos (normalizados). Al conciliar o imputar una línea contra una
  contraparte, su descriptor se agrega — el mes siguiente esa línea matchea
  con confianza alta.
- **`OrigenMovimiento` += `RESUMEN`**: los movimientos imputados desde una
  línea. `ESTADOS_INICIALES.RESUMEN = ['ASIGNADO', 'VALIDADO']` (ASIGNADO con
  imputación completa; VALIDADO si se guarda sin distribución). No pasan por
  ARCA ni exigen CUIT (contraparte opcional; si se crea una nueva sin CUIT se
  usa el identificador `EXT-`).

## Extracción

Pipeline calcado del de recibos: subida → `Resumen` PROCESANDO → un `Job`
`EXTRACCION_RESUMEN` → worker → líneas + metadatos → estado EXTRAIDO.

Extractor (`lib/extractor/resumen*.ts`, tool forzado, `EXTRACTOR_MODE`):
- Devuelve: `tipo` (tarjeta/banco si es reconocible), `emisor`, `periodo`
  (anio/mes), `fechaCierre?`, `totalDeclarado?`, `lineas[]` con `{fecha,
  descriptor, monto firmado, moneda, montoOrigen?, cuotas?}`.
- Prompt agnóstico del formato (cada banco/tarjeta emite distinto), con
  reglas: los consumos/débitos son NEGATIVOS y los pagos/créditos POSITIVOS;
  excluir líneas de encabezado/subtotal; en consumos en moneda extranjera
  capturar ambos importes.
- Mismo circuito de errores que recibos: job failed visible en la UI.

## Matching línea ↔ movimiento (anti-duplicados)

`lib/resumenes/matching.ts`, PURO y testeado. Para cada línea extraída se
puntúan los movimientos candidatos (misma empresa, estado NO en
`ANULADO|DUPLICADO`, `fechaDevengamiento` o `createdAt` en ±45 días de la
fecha de la línea, sin otra línea ya CONCILIADA apuntándoles):

| Señal | Peso | Detalle |
|---|---|---|
| Monto | fuerte | `|linea.monto|` vs total del movimiento (±$1); si la línea es USD, compara también `montoOrigen` vs total USD del movimiento |
| Fecha | medio | distancia entre fecha de línea y fechaEmision/devengamiento (0 días = máximo; decae hasta ±45) |
| Texto | medio | descriptor normalizado vs razón social de la contraparte + descriptores aprendidos (similitud por tokens/bigramas, sin dependencias nuevas) |

Umbrales: score alto (monto + [fecha o texto]) → línea **SUGERIDA** con ese
movimiento; score medio (una sola señal) → PENDIENTE con `candidatos`
rankeados; sin señales → PENDIENTE sin candidatos. El matching corre al
extraer y puede re-ejecutarse a demanda ("Re-matchear" en la UI, p.ej.
después de cargar comprobantes atrasados).

## Acciones sobre una línea (servicio + auditoría)

- **Conciliar** (`RESUMEN_CONCILIAR`): vincula la línea a un movimiento
  existente. NO crea gasto (el gasto ya está en el libro) — acá muere el
  doble conteo. Un movimiento admite UNA línea conciliada (guard). Aprende el
  descriptor en la contraparte del movimiento.
- **Imputar** (`RESUMEN_IMPUTAR`): crea un `Movimiento` origen `RESUMEN` con
  total = |monto| de la línea **siempre en ARS** (la tarjeta/cuenta debitó
  pesos; si la línea era USD, el movimiento nace en ARS y el TC implícito
  queda como referencia en la línea), fechaDevengamiento = fecha de línea,
  descripcion = descriptor, contraparte opcional
  (existente o nueva sin CUIT vía EXT-), categoría + distribución del
  mini-form → nace ASIGNADO (o VALIDADO sin distribución). Respeta período
  abierto (cerrado → DomainError). La línea queda IMPUTADA apuntando al
  movimiento creado.
- **Ignorar** (`RESUMEN_IGNORAR`): con motivo (pago del resumen anterior,
  saldo, impuesto ya contenido en otra línea). Reversible.
- **Deshacer** cualquiera de las tres (línea vuelve a PENDIENTE; imputar
  deshecho ANULA el movimiento creado si el período está abierto).
- Roles: subir/gestionar resúmenes y conciliar exige VALIDADOR+.

## UI

- **Sidebar Registros → "Resúmenes"**.
- **`/[slug]/resumenes`**: subida (tipo + emisor + PDF) y lista de resúmenes
  con: emisor, tipo, período, total declarado, **progreso de conciliación**
  (resueltas/total con mini barra) y estado de extracción.
- **`/[slug]/resumenes/[id]`** — la bandeja de conciliación:
  - Header: datos del resumen + barra de progreso + **control de
    completitud**: suma de líneas vs `totalDeclarado` (si no cierra, banner
    ámbar con la diferencia).
  - Lista de líneas, una fila cada una: fecha, descriptor, monto (rojo/verde
    según signo), cuotas, y **chip de estado por color**: ámbar "sugerida"
    (muestra el movimiento propuesto + botón Confirmar), verde "conciliada"
    (link al movimiento), azul "imputada" (link), gris "ignorada", blanco
    "pendiente".
  - Click en una línea → panel con: candidatos rankeados (score + por qué
    matchean) con "Conciliar", buscador manual de movimientos, el mini-form
    de **imputación** (categoría + DistribucionEditor + contraparte opcional,
    con regla de asignación aplicable como sugerencia), e "Ignorar" con
    motivo.
  - Acción masiva: "Confirmar todas las sugeridas" (sólo las de score alto).
- El detalle de un movimiento (Validación/Comprobantes) muestra el vínculo
  "conciliado con la línea X del resumen Y" cuando existe.

## Interacción con el resto del sistema

- Los movimientos origen RESUMEN entran al libro/P&L como cualquier ASIGNADO
  (netos: sin desglose de IVA salvo que la línea lo traiga — el desglose B
  manual queda disponible en el detalle). Las líneas de impuestos bancarios
  se imputan a la categoría Impuestos (o la que corresponda) — el memo del
  P&L no cambia.
- Duplicado por hash del archivo del resumen: re-subir el mismo PDF avisa y
  no re-extrae (mismo criterio que comprobantes, adaptado: bloquea creación).
- Cierre de período: imputar sobre período cerrado se rechaza; conciliar es
  libre (no toca el libro).
- Un movimiento DUPLICADO/ANULADO no es candidato de matching.

## Testing

- Matching puro: señales por separado, umbrales, el caso Anthropic (mismo
  monto + descriptor similar → sugerida), USD por montoOrigen, exclusión de
  movimientos ya conciliados.
- Extractor: schema zod con fixture de resumen sintético.
- Integración (DB): conciliar no crea movimiento (conteo del libro invariante),
  imputar crea ASIGNADO con origen RESUMEN y línea IMPUTADA, deshacer, guard
  de un-movimiento-una-línea, período cerrado rechaza imputación.
- Autorización: CARGADOR no accede.
- E2E en dev con un resumen real del usuario (validar extracción de su
  formato de tarjeta y de banco).

## Fuera de alcance (por ahora)

- Import CSV/OFX de home banking (sólo PDF v1).
- Matching contra líneas de OTROS resúmenes (transferencias entre cuentas).
- Auto-imputación por reglas de líneas sin comprobante (v2: reglas por
  descriptor).
