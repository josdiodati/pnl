# Captura real de comprobantes — Etapa 1 (diseño)

Fecha: 2026-06-23
Estado: aprobado para plan de implementación

## Objetivo

Primer objetivo post-MVP: tener una pantalla con **comprobantes reales procesados**. Para
eso, pasar el motor de captura de mock a **real** sobre los datos reales de
**Kawellu Soluciones SRL** (carpeta `Docs/ComprobantesEjemplos/`, ~325 PDFs + 1 HTML),
con foco en **captura web** (email queda para una etapa posterior).

Regla de negocio central: **todo comprobante debe ser válido por ARCA para poder
validarse, salvo que el usuario habilite un override explícito** (caso de servicios
extranjeros sin comprobante fiscal argentino: AWS, Claude, Google).

## Hallazgos sobre la data real (análisis empírico)

- **325 PDFs + 1 `.aspx`** (HTML export de Google Workspace vía TECO).
- **266/325 (82%)** tienen capa de texto extraíble; **262** mencionan CAE → comprobantes
  electrónicos fiscales argentinos legibles directo del texto.
- **59/325 (18%)** sin texto (casi todos 0 chars) → tickets/fotos (`GG_*`: combustible,
  lunch, parking, librería), requieren OCR de visión.
- El texto extraído viene **desordenado por el layout en columnas** → un LLM leyendo el
  texto es mucho más robusto que regex.
- Todo comprobante fiscal AR trae **QR de AFIP** (imagen) con JSON autoritativo
  (`cuit, ptoVta, tipoCmp, nroCmp, importe, codAut`). No aparece en la extracción de texto.
- La data tiene **ventas y compras**: los `30718332148_001_00001_*` son ventas emitidas por
  Kawellu (CUIT 30718332148); el resto son compras (Kawellu receptor).

## Arquitectura existente reutilizada (NO se reconstruye)

- `lib/pipeline.ts` — pipeline único multicanal: archivo inmutable → Movimiento INGRESADO
  → job EXTRACCION → worker extrae → checks → matching contraparte → ARCA →
  PENDIENTE_VALIDACION / RETENIDO.
- `lib/extractor/` — abstracción `DocumentExtractor` con `MockExtractor` y
  `AnthropicExtractor` (ya hace branch **texto-vs-visión** y output estructurado por tool forzado).
- `lib/arca/` — mock + esqueleto WS real, campo `arcaEstado`
  (`NO_VERIFICADO|VALIDO|INVALIDO|ERROR_CONSULTA`).
- `lib/checks/`, `lib/periodos.ts`, matching de contraparte, pre-creación de distribución default.
- Validación ya tiene override `confirmarArcaInvalido` (criterio de aceptación 5).
- `Empresa.cuit` existe → permite detectar dirección venta/compra.

## Decisiones de diseño (confirmadas)

1. **QR**: solo verificación / cross-check. No bloquea si no existe.
2. **ARCA**: mock realista + flujo de override real (la integración AFIP real se enchufa
   después sin tocar UI).
3. **Alcance etapa 1**: extractor real + ARCA(mock) con override → comprobantes reales en la
   **cola de validación** con datos extraídos y archivo visible. No se tocan Movimientos/Períodos.
4. **Setup datos**: seed real (reemplaza demo) + import masivo por el mismo pipeline.
5. **Ventas vs compras**: **detectar y separar** (nuevo valor en enum `OrigenMovimiento`).
6. **Seed**: usuario Jose Diodati / `jose.diodati@gmail.com` admin de Kawellu (CUIT
   30718332148) y Ewwo Consulting SRL (CUIT placeholder válido editable). Datos editables
   desde Configuración.

## Componentes a construir / modificar

### A. Motor de extracción — `lib/extractor/anthropic.ts` + `lib/extractor/schema.ts`

- **Modelo por defecto → `claude-opus-4-8`** (hoy `claude-sonnet-4-6`); sigue configurable
  por `EXTRACTOR_MODEL`.
- Mantener el branch texto-vs-visión existente. Endurecer detección de "tiene texto"
  (umbral y normalización), y subir el recorte de texto pasado al modelo.
- **Campos nuevos en `extraccionSchema` + `extraccionJsonSchema`**:
  - `cuitReceptor: string | null`
  - `razonSocialReceptor: string | null`
  - `esComprobanteFiscalArg: boolean` (true si es factura/NC/ND/ticket argentino con CAE;
    false para invoices extranjeros tipo AWS/Claude/Google).
- Prompt: agregar instrucción para extraer receptor y para marcar `esComprobanteFiscalArg`.
- Interfaz `DocumentExtractor.extract` y el patrón de tool forzado se mantienen.

Unidad: el extractor sigue siendo una caja con interfaz estable (`extract(input) → Extraccion`);
el pipeline no cambia su forma de invocarlo.

### B. Cross-check de QR — `lib/extractor/qr.ts` (nuevo)

- `leerQrAfip(buffer: Buffer): Promise<QrAfip | null>`:
  - Rasteriza la 1ª página del PDF (vía `unpdf`/pdfjs a canvas/imagen) y decodifica el QR
    con una lib JS (`jsqr` u equivalente).
  - Si el QR es de AFIP (`https://www.afip.gob.ar/fe/qr/?p=<base64 json>`), parsea el JSON.
  - Devuelve `null` si no hay QR o no se puede decodificar (best-effort, no rompe).
- En el pipeline: si hay QR, comparar `cuit/ptoVta/nroCmp/importe/codAut` contra lo extraído;
  discrepancias → `camposRevisar.qr = "QR AFIP no coincide: <campos>"`. Guardar el payload del
  QR en `extraccionRaw.qrAfip`.
- Dependencia nueva: lib de decodificación QR (a elegir en el plan; `jsqr` es candidato).

### C. Detección de dirección venta/compra — `lib/pipeline.ts` + `prisma/schema.prisma`

- Tras extraer y normalizar `cuitEmisor`, obtener `empresa.cuit`.
  - `cuitEmisor === empresa.cuit` → **venta con comprobante**.
  - caso contrario → **compra** (origen `COMPROBANTE`, como hoy).
- Cambio de modelo: agregar valor `VENTA_COMPROBANTE` al enum `OrigenMovimiento`
  (migración Prisma). Para ventas, el matching de contraparte usa el **receptor** (cliente),
  no el emisor.
- Las ventas con comprobante caen igual en la cola de validación (se distinguen por `origen`).

### D. Gate de ARCA + override — `lib/pipeline.ts` y `app/(app)/[empresaSlug]/validacion/actions.ts`

- **Enforcement en `validarAction` (backend)**: no permitir transición a VALIDADO si
  `arcaEstado !== 'VALIDO'`, salvo que venga uno de los overrides:
  - `confirmarArcaInvalido` (existente) → cuando `arcaEstado === 'INVALIDO'`.
  - `overrideNoFiscal` (nuevo) → cuando el comprobante no es fiscal argentino
    (`esComprobanteFiscalArg === false` o sin CAE: `arcaEstado === 'NO_VERIFICADO'`).
- El override exige **motivo** y queda en auditoría (reusar `writeAudit`).
- UI (`components/validacion-form.tsx`): mostrar el checkbox/lÍnea de override correspondiente
  según el estado ARCA, con campo de motivo. (Cambio mínimo, dentro del alcance "revisión".)

### E. Seed real — `prisma/seed.ts`

- Reemplaza el seed demo (`admin@demo.test` / Empresa Alfa-Beta).
- Usuario **Jose Diodati**, email `jose.diodati@gmail.com`, password demo documentada en
  README (editable).
- Empresas:
  - **Kawellu Soluciones SRL**, CUIT `30718332148`, Jose ADMINISTRADOR.
  - **Ewwo Consulting SRL**, CUIT placeholder válido (dígito verificador correcto), Jose
    ADMINISTRADOR. Editable desde Configuración.
- Maestros mínimos por empresa: categorías de ingreso/egreso base, centros de costo
  (BPO/SF/Administración o equivalente), sin contrapartes precargadas (se autodescubren).
- No se precargan movimientos demo (los reales entran por el import).

### F. Import masivo — `scripts/import-comprobantes.ts` (nuevo)

- Recorre `Docs/ComprobantesEjemplos/` y, por cada archivo, llama
  `ingestarComprobante({ empresaId: kawellu, canal: 'WEB', buffer, filename, mime })`.
- Detecta MIME por extensión. En etapa 1 procesa solo PDFs; el único `.aspx` (HTML de
  Google Workspace) se **omite del import** y se deja registrado en el log (su tratamiento
  como no-fiscal queda para una iteración posterior).
- Procesa la cola (reusar el worker o drenar los jobs en el mismo script).
- Idempotente: el pipeline ya deduplica por hash de archivo.
- Salida: log de cuántos quedaron PENDIENTE_VALIDACION / RETENIDO / ERROR, y conteo
  compras vs ventas detectadas.

## Flujo end-to-end resultante (etapa 1)

```
Archivo (web o import masivo)
  → ingestarComprobante → Movimiento INGRESADO + job EXTRACCION
  → worker: AnthropicExtractor (texto si hay capa, PDF-visión si imagen) [opus-4-8]
      + cross-check QR (best-effort)
  → detección dirección (compra/venta por CUIT)
  → checks deterministas + matching contraparte (+ camposRevisar)
  → ARCA (mock) si hay CAE → arcaEstado
  → PENDIENTE_VALIDACION (o RETENIDO si período cerrado)
  → cola de validación: documento + datos extraídos + ARCA + dirección
  → validar: requiere ARCA VALIDO u override (no-fiscal / inválido) con motivo auditado
```

## Variables de entorno

- `EXTRACTOR_MODE=real` y `ANTHROPIC_API_KEY` para captura real (sin ellas, cae a mock).
- `EXTRACTOR_MODEL` (default `claude-opus-4-8`).
- `ARCA_MODE=mock` (default).

## Fuera de alcance (etapa 1)

- Captura por email/Telegram real (la infraestructura existe; se activa después).
- Integración ARCA WS real (esqueleto listo; requiere certificado AFIP).
- Pantallas de Movimientos/Períodos/Reportes formateados (no se tocan).
- Prorrateos, headcount.

## Criterios de aceptación de la etapa

1. Con `EXTRACTOR_MODE=real`, un PDF con capa de texto se extrae sin visión y con los
   campos correctos (CUIT, tipo, PV, número, CAE, neto/IVA/total, receptor).
2. Un PDF imagen (ticket) se extrae por visión.
3. El cross-check de QR marca `camposRevisar.qr` ante discrepancia y no rompe cuando no hay QR.
4. Una venta emitida por Kawellu se detecta como `VENTA_COMPROBANTE`.
5. Un comprobante no-fiscal (sin CAE) no se puede validar sin `overrideNoFiscal` + motivo;
   el override queda en auditoría.
6. El import masivo deja los comprobantes reales de Kawellu procesados en la cola de validación.
7. El seed crea a Jose Diodati admin de Kawellu y Ewwo; el switcher funciona.
