# 04 — Captura y OCR

El feature central. La meta es que cargar un comprobante sea casi sin fricción y que el dato salga confiable.

## Canales de entrada

1. **Upload web** — drag & drop, múltiples archivos. Formatos: PDF, JPG, PNG, WEBP. Por ahora **1 archivo = 1 comprobante** (PDF multipágina = un solo comprobante; el split automático en N comprobantes es fast-follow, no MVP). Es la home de la app.
2. **Foto desde el celular** — la misma pantalla con `<input capture>`; pensada para sacar la foto de la factura de papel en el momento.
3. **Email entrante** — webhook `POST /api/inbound-email` (formato Postmark/SES). Identifica la empresa por la dirección destino `comprobantes+{slugEmpresa}@dominio`. Cada adjunto entra al pipeline. Protegido por `INBOUND_EMAIL_SECRET`. Modo mock: un endpoint de prueba que acepta un payload de ejemplo. Documentar en README cómo conectar el proveedor real.
4. **Telegram** — bot vía webhook `POST /api/telegram`. El usuario vincula su chat a una empresa una vez (comando `/vincular {codigo}` donde el código se genera en la pantalla de config de la empresa). Después, cada foto o documento que manda al bot entra al pipeline de esa empresa, con `canalIngreso=TELEGRAM`. El bot responde confirmando recepción y, tras procesar, avisa si quedó algo para revisar. Requiere `TELEGRAM_BOT_TOKEN`; si falta, el canal queda deshabilitado con aviso claro. Deduplicar por `update_id`. Documentar en README cómo crear el bot con BotFather y setear el webhook.

Todos los canales convergen en el **mismo pipeline** y la **misma cola de validación**.

## Pipeline (asíncrono, vía tabla Job)

1. **Recepción**: guardar el archivo con `FileStorage` (inmutable), calcular SHA-256, crear `Movimiento` en estado `INGRESADO` con `origen=COMPROBANTE` y `canalIngreso`. Encolar Job `EXTRACCION`.
2. **Procesando**: el worker toma el Job, marca el movimiento `PROCESANDO`.
3. **Extracción**:
   - Si el PDF tiene capa de texto (factura electrónica), extraer texto y mandarlo como texto al LLM (más barato/preciso).
   - Si es imagen o PDF escaneado, mandar la imagen al modelo con visión.
   - Si la contraparte (por CUIT, si ya se conoce de un intento previo) tiene `instruccionesExtraccion`, inyectarlas al prompt.
   - Forzar salida JSON con el esquema de abajo (tool use / JSON schema).
4. **Checks deterministas** (§ siguiente) → marcar campos OK/REVISAR, detectar duplicados.
5. **Matching**: cruzar `cuitEmisor` contra el maestro de contrapartes de la empresa. Si existe, proponer `categoriaDefault` y `distribucionDefault`. Si no, marcar "contraparte nueva".
6. **Constatación ARCA** (ver doc 05) si hay CAE.
7. Pasar a `PENDIENTE_VALIDACION` (o `RETENIDO` si el período de la fecha está cerrado — ver doc 07).
8. Si la extracción falla tras `maxIntentos`: `ERROR_PROCESAMIENTO`, con opción de reintentar o cargar a mano.

## Esquema de extracción (salida JSON estricta del LLM)

```json
{
  "tipoComprobante": "FACTURA_A|FACTURA_B|FACTURA_C|FACTURA_E|NOTA_CREDITO_A|NOTA_CREDITO_B|NOTA_CREDITO_C|NOTA_DEBITO_A|NOTA_DEBITO_B|NOTA_DEBITO_C|TICKET|RECIBO|OTRO",
  "puntoVenta": "string|null",
  "numero": "string|null",
  "fechaEmision": "YYYY-MM-DD|null",
  "cuitEmisor": "string|null",
  "razonSocialEmisor": "string|null",
  "netoGravado": "number|null",
  "iva21": "number|null",
  "iva105": "number|null",
  "iva27": "number|null",
  "percepcionesIva": "number|null",
  "percepcionesIibb": "number|null",
  "otrosTributos": "number|null",
  "noGravadoExento": "number|null",
  "total": "number|null",
  "moneda": "ARS|USD|EUR|OTRA",
  "cae": "string|null",
  "vencimientoCae": "YYYY-MM-DD|null",
  "confianza": { "<campo>": 0.0 },
  "observaciones": "string|null"
}
```

### Reglas del prompt del extractor
- No inventar: ante la duda, `null`.
- Facturas de servicios con **dos vencimientos**: tomar SIEMPRE el importe del **primer** vencimiento.
- **Notas de crédito/débito**: extraer importes en positivo; el `tipoComprobante` define el signo al contabilizar (la NC de compra reduce el gasto).
- Devolver un nivel de `confianza` por campo cuando sea posible (la cola ordena "más dudoso primero").

## Checks deterministas (`lib/checks`)

Cada campo → `OK` | `REVISAR`. El movimiento no se valida solo; esto solo colorea y alerta.
- **Aritmética**: `neto + iva21 + iva105 + iva27 + percIva + percIibb + otrosTributos + noGravado == total` (tolerancia ±$1).
- **CUIT**: dígito verificador módulo 11 (implementar y testear). CUIT inválido → REVISAR.
- **Fecha**: no futura, no > 5 años atrás.
- **Duplicado**: existe otro movimiento de la empresa con igual `cuitEmisor + tipoComprobante + puntoVenta + numero` → alerta prominente (no bloquea).
- **Coherencia (alertas blandas, opcionales pero recomendadas)**: monto fuera del rango histórico de esa contraparte; CUIT de tipo CLIENTE cargado como gasto; factura A sin IVA discriminado.

## Aprendizaje sin reentrenar
Las correcciones del validador no tocan el modelo: si para un CUIT siempre se corrige el mismo campo, el validador guarda una nota en `Contraparte.instruccionesExtraccion` que se inyecta al prompt en las próximas extracciones de ese emisor. Determinístico, auditable, barato.

## Cola de validación (pantalla)
- Lista filtrable (estado, contraparte, fecha, monto, alertas, canal) con contadores; orden por confianza/antigüedad.
- **Vista lado a lado**: visor del documento original (PDF/imagen con zoom) a la izquierda; formulario de campos a la derecha con los `REVISAR` en amarillo, alertas de duplicado y de ARCA inválido bien visibles.
- En esta pantalla el validador: corrige campos, elige o **crea la contraparte** sin salir, confirma categoría, define la **distribución** (centro de costo + cliente/proyecto, porcentual — ver doc 06), agrega instrucciones de extracción si aplica, y valida.
- Botón **"validar y siguiente"** para procesar la cola en serie. Validar un comprobante limpio = un click.
- Acción **"observar"** (estado `OBSERVADO`) para apartar un comprobante raro sin validarlo ni anularlo.
