# Spec F — Cobranzas de ventas y proyección de ingresos (diseño)

Fecha: 2026-09-24
Estado: aprobado por el usuario para implementar las 3 etapas sin revisión intermedia
("decidilo vos, anotá lo que decidiste"). Las decisiones propias están en la
sección **Registro de decisiones**, con su porqué.

## Contexto

La vista de Ventas muestra comprobantes emitidos, pero "cobrado" sólo se conoce
cuando llega el resumen del banco a fin de mes y se concilia la línea contra la
factura. El usuario quiere seguir los cobros de forma dinámica (tipo cashflow):
qué falta cobrar, cuándo va a entrar, cheques con fecha futura.

Relación N:N: un pago puede cancelar varias facturas y una factura puede cobrarse
con varios instrumentos (p. ej. varios cheques). Es un P&L, no un sistema
contable: rapidez y facilidad antes que exactitud total con procesos engorrosos.

Datos reales (Ewwo, jul–sep 2026) que definen el diseño:

- Comnet paga neto de retenciones (~1,65% menos que la factura). El matching
  exige monto exacto y esos casos se conciliaron a mano.
- Plazos por cliente muy distintos: Kawellu el mismo día, Comnet 5–13 días,
  la Mutual 30 días.
- Las facturas E (USD) se cobran en pesos por "Comex cobro exportación" con un
  tipo de cambio distinto al de la factura.
- Las facturas de servicios de ARCA imprimen "Fecha de Vto. para el pago"; el
  texto ya guardado de cada venta lo contiene.

### Decisiones del usuario

- Diferencia de cambio: **se genera un ajuste** (asiento) cuando el cobro de una
  factura en moneda extranjera se registra a un tipo de cambio distinto, para
  que el P&L se condiga con la realidad.
- Se implementan las tres etapas completas.

## Principios

1. **El cobro no toca el P&L.** El P&L sigue siendo devengado. La única
   excepción es el ajuste por diferencia de cambio (decisión del usuario).
2. **Nadie carga dos veces lo mismo.** Un cobro registrado a mano se confirma
   con el resumen; una línea del banco conciliada contra una venta sin cobro
   crea el cobro sola.
3. **Automático primero, corregible después.** Reparto FIFO, fecha probable
   derivada, retenciones chicas cerradas solas.

## Modelo de datos

```prisma
enum InstrumentoCobro { TRANSFERENCIA CHEQUE ECHEQ EFECTIVO RETENCION NOTA_CREDITO OTRO }
enum EstadoCobro { EN_CARTERA ACREDITADO RECHAZADO }
enum OrigenCobro { MANUAL RESUMEN }

model Cobro {
  id                String           @id @default(cuid())
  empresaId         String
  grupo             String           // instrumentos registrados juntos (un "recibo")
  origen            OrigenCobro      @default(MANUAL)
  contraparteId     String?
  instrumento       InstrumentoCobro
  estado            EstadoCobro      @default(ACREDITADO)
  fecha             DateTime         // recepción del pago
  fechaAcreditacion DateTime         // esperada (cheque) o real
  moneda            Moneda           @default(ARS)
  monto             Decimal          @db.Decimal(18, 2)
  tipoCambio        Decimal?         @db.Decimal(12, 4) // pesos por unidad de la moneda de las facturas
  numero            String?
  banco             String?
  nota              String?
  resumenLineaId    String?          // línea del banco que lo confirma
  creadoPorId       String
  aplicaciones      CobroAplicacion[]
  createdAt         DateTime         @default(now())
}

model CobroAplicacion {
  id           String  @id @default(cuid())
  cobroId      String
  movimientoId String  // la venta
  importe      Decimal @db.Decimal(18, 2) // en la moneda de la factura
  importeArs   Decimal @db.Decimal(18, 2) // pesos que aporta
  ajusteId     String? // asiento de diferencia de cambio generado
  @@unique([cobroId, movimientoId])
}
```

- `Movimiento` suma `fechaVencimientoPago` (extraída) y `fechaCobroEstimada`
  (override manual).
- `Contraparte` suma `plazoCobroDias` (opcional).
- `Cobro` va a `SCOPED_MODELS`; `CobroAplicacion` se scopea por su cobro.

## Reglas de negocio

**Saldo de una venta** = total − Σ `importe` de aplicaciones de cobros no
RECHAZADOS, en la moneda de la factura. Estados: COBRADA (saldo ≤ 0,01),
PARCIAL, PENDIENTE; VENCIDA si hay saldo y la fecha probable ya pasó. Las notas
de crédito y las ventas anuladas, duplicadas o en error no son cobrables.

**Fecha probable**, primera que exista:
1. `fechaCobroEstimada` (manual).
2. `fechaVencimientoPago` de la factura.
3. Fecha de la factura + `plazoCobroDias` del cliente.
4. Fecha de la factura + atraso promedio histórico del cliente (últimas 6
   facturas cobradas completas, redondeado).
5. Fecha de la factura + 30 días.

Se muestra con su fuente ("vencimiento", "plazo del cliente", "histórico"…).

**Registrar cobro** (manual): una o varias ventas de la misma moneda + uno o
varios instrumentos. Reparto FIFO: ventas por fecha ascendente; instrumentos
bancarios primero, retenciones y NC al final. No puede superar el saldo.
Si falta ≤ 5% del saldo seleccionado y la moneda es ARS, se ofrece (marcado por
defecto) cerrar la diferencia como RETENCION. Cheque/e-cheq nacen EN_CARTERA;
el resto ACREDITADO.

**Moneda extranjera**: si las facturas son USD y el instrumento es ARS, se usa
la cotización del cobro (ingresada o implícita = pesos / saldo USD cuando cubre
todo). `importe` = pesos / cotización. **Ajuste**: por cada aplicación,
diferencia = `importeArs` − `importe` × TC de la factura. Si |diferencia| ≥ 1
peso, se crea un ASIENTO_MANUAL en la categoría INGRESO "Diferencia de cambio"
(se crea si no existe), total firmado = diferencia, fecha = fecha del cobro,
`relacionadoId` = factura, distribución copiada de la factura (ASIGNADO); sin
distribución queda PENDIENTE_VALIDACION. Deshacer el cobro anula el ajuste.

**Cheques**: EN_CARTERA → ACREDITADO (al conciliar con el banco o a mano) o
RECHAZADO (el saldo vuelve a la factura). Sin endoso ni depósito.

**Eliminar cobro**: borra el grupo completo y anula sus ajustes. Bloqueado si
algún instrumento está confirmado por una línea del banco (deshacer primero).
Anular una venta con cobros está bloqueado.

## Etapa 3: conciliación bancaria

- **Candidatos**: para líneas positivas (créditos), los cobros registrados sin
  confirmar (TRANSFERENCIA, CHEQUE, ECHEQ, OTRO) se ofrecen como candidato con
  su monto y su fecha de acreditación; el candidato apunta a la primera venta
  del cobro (la UI de conciliación no cambia). Las ventas con saldo se ofrecen
  por su **saldo**; en ARS cuenta como señal de monto un crédito entre 95% y
  100% del saldo (neto de retenciones); en moneda extranjera, ±5% del saldo
  pesificado al TC de la factura.
- **Conciliar** una línea positiva contra una venta: si hay un cobro registrado
  sin confirmar aplicado a esa venta cuyo monto coincide (±1 peso) con la línea,
  se confirma ese cobro (cheque → ACREDITADO) y se vinculan todas sus ventas.
  Si no, se **sincronizan** cobros automáticos (origen RESUMEN) de la línea:
  monto de la línea repartido FIFO entre las ventas vinculadas; si a una venta
  en ARS le queda ≤ 5% sin cubrir, se cierra con una RETENCION automática; en
  USD la cotización implícita es pesos / saldo USD y se genera el ajuste.
- Desvincular o deshacer la línea recalcula: los cobros automáticos se borran y
  se recrean con lo que quede; los manuales vuelven a "sin confirmar".

## Vistas

- **Ventas**: columna "Cobro" (estado, saldo, fecha probable con fuente y
  editable en la celda), filtro por estado de cobro, tarjeta "A cobrar",
  selección múltiple + "Registrar cobro", link a la cobranza de cada factura.
- **Registrar cobro** (`/ventas/cobro?ids=`): facturas elegidas con su saldo,
  filas de instrumentos, vista previa del reparto, sugerencia de retención,
  cotización para USD.
- **Cobranza de una factura** (`/ventas/[id]/cobros`): saldo, fecha probable,
  cobros aplicados, eliminar cobro, "cerrar saldo como retención".
- **Cobranzas** (`/cobranzas`, VALIDADOR+): KPIs (a cobrar, vencido, cheques en
  cartera, próximos 30 días), proyección semanal 12 semanas separando
  confirmado (cheques) de estimado (facturas), antigüedad por cliente, cheques
  en cartera con acreditar/rechazar, facturas pendientes por fecha probable.
- **Maestros → contrapartes**: campo "Plazo de cobro (días)".

## Extracción y datos existentes

- `fechaVencimientoPago` entra al esquema de extracción del LLM y, como
  respaldo determinístico, se lee del texto del documento ("Período Facturado
  Desde: Hasta: Fecha de Vto. para el pago:" seguido de tres fechas; la tercera).
- Script idempotente `scripts/backfill-cobranzas.ts`: completa el vencimiento
  de las ventas desde su texto y sincroniza los cobros de las líneas de banco
  ya conciliadas contra ventas.

## Fuera de alcance

Recibos numerados, endoso/depósito de cheques, reclamo de rechazados, intereses
por mora, retenciones como crédito fiscal con certificado, pagos a proveedores
(el modelo queda listo para extenderse), compensación intercompany.

## Registro de decisiones (tomadas por Claude, para revisar con el usuario)

| # | Decisión | Por qué |
|---|---|---|
| D1 | Las retenciones y NC son un **instrumento** más del cobro, no un campo aparte | Un único modelo cubre "transferencia + retención" sin columnas extra; la proyección y el banco simplemente los excluyen |
| D2 | Reparto **FIFO automático**, sin grilla de edición | Rapidez; si el reparto importa, se registra un cobro por factura. Cambiar el reparto = eliminar y recargar |
| D3 | Umbral de retención automática **5%** | Comnet retiene 1,65%; combinaciones IIBB + Ganancias rondan 2–4%. Un pago parcial de más del 95% es raro |
| D4 | Plazo por defecto **30 días** fijo, sin configuración por empresa | Es el estándar comercial; el override por cliente y el histórico lo corrigen solos |
| D5 | Histórico = promedio de las **últimas 6** facturas cobradas completas | Suficiente para estabilizar sin arrastrar comportamiento viejo |
| D6 | Un cobro no puede **superar** el saldo | Evita "saldos a favor" que exigirían cuenta corriente; es un P&L |
| D7 | Todas las facturas de un cobro en la **misma moneda** | Evita cotizaciones cruzadas ambiguas |
| D8 | Ajuste de cambio con umbral **1 peso**, categoría "Diferencia de cambio" (INGRESO, se crea sola), fecha = cobro, distribución copiada de la factura | Mismo cliente/proyecto que la venta; negativo = pérdida. El mes del cobro es cuando se realiza la diferencia |
| D9 | En la conciliación, el candidato de un cobro apunta a su **primera venta** | No hay que rediseñar la bandeja de conciliación (810 líneas); el servicio resuelve el cobro |
| D10 | Cobros automáticos del banco se **recrean** en cada cambio de la línea | Idempotente y simple; los manuales nunca se borran por el banco |
| D11 | Cheque con fecha pasada sigue EN_CARTERA hasta que el banco o el usuario lo acredita | El estado refleja plata en la cuenta, no la fecha escrita |
| D12 | Registrar/eliminar cobros y ver Cobranzas: rol **VALIDADOR**+; la columna de Ventas la ven todos | Igual que conciliación de resúmenes |
| D13 | `creadoPorId` del cobro sin FK a Usuario | Evita tocar el modelo Usuario; se audita en AuditLog |
| D14 | El vencimiento se completa para ventas **existentes** desde el texto ya guardado | Sin gastar tokens ni re-procesar |
