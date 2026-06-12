# P&L Manager

Aplicación web multi-empresa para llevar el **P&L de gestión** de un grupo de empresas argentinas: captura de comprobantes (web, foto, email, Telegram) con OCR por LLM, checks deterministas, constatación contra ARCA, cola de validación humana lado a lado, y asignación en **doble dimensión** (centro de costo + cliente/proyecto) con reparto porcentual. Criterio de devengado, períodos mensuales con cierre, nada se borra (se anula), auditoría completa.

**Stack**: Next.js 14 (App Router) + TypeScript · PostgreSQL + Prisma · Auth.js (credenciales) · Tailwind CSS · cola de jobs en Postgres (sin Redis) · worker por polling. Toda la app corre de punta a punta **sin ninguna credencial externa** (modo mock por defecto).

---

## Requisitos

- Node.js 20+ (probado con 24)
- PostgreSQL 14+ — **o nada**: el repo incluye un script que levanta un PostgreSQL en espacio de usuario (sin root ni Docker) usando los binarios de `embedded-postgres`.

## Setup paso a paso

```bash
npm install

# 1) Variables de entorno
cp .env.example .env
# Editá NEXTAUTH_SECRET (openssl rand -base64 32). Con los defaults ya corre todo en mock.

# 2) Base de datos
./scripts/dev-db.sh start          # PostgreSQL local en :5433, datos en ./.pgdata
#    (alternativa: apuntá DATABASE_URL a tu propio Postgres)
npx prisma db push                 # crea el esquema

# 3) Seed con datos demo (usuarios, 2 empresas, maestros, ~16 movimientos, PDFs)
npx prisma db seed

# 4) App + worker (dos terminales)
npm run dev                        # http://localhost:3000  (o npm run build && npm start)
npm run worker                     # procesa OCR / ARCA / email / telegram

# 5) Tests (60 tests, incluye integración de aislamiento multi-empresa contra la DB)
npm test
```

> El **worker es necesario** para que los comprobantes subidos pasen de "Ingresado" a la cola de validación. `./scripts/dev-db.sh stop` detiene la base.

### Credenciales demo (las crea el seed)

| Usuario | Password | Empresa Alfa S.A. | Empresa Beta S.R.L. |
|---|---|---|---|
| `admin@demo.test` | `demo1234` | **Administrador** | **Validador** |
| `operador@demo.test` | `demo1234` | **Cargador** | — (sin acceso) |

El seed deja: 3 meses de movimientos (el más viejo **cerrado**, con un comprobante **retenido**), validados / pendientes / un observado / un anulado con motivo, ventas y asientos manuales, distribuciones porcentuales con doble dimensión, 2 plantillas de distribución, 2 recurrentes, ~10 contrapartes con CUIT válido y 3 PDFs de ejemplo (visor + OCR mock). Código de vínculo Telegram de Alfa: `ALFA1234`.

---

## Variables de entorno

| Variable | Obligatoria | Default | Para qué |
|---|---|---|---|
| `DATABASE_URL` | **Sí** | — | PostgreSQL (`postgresql://pnl:pnl@localhost:5433/postgres` con el script local) |
| `NEXTAUTH_SECRET` | **Sí** | — | Firma de sesiones Auth.js (`openssl rand -base64 32`) |
| `EXTRACTOR_MODE` | No | `mock` | `mock` \| `real` (real requiere `ANTHROPIC_API_KEY`) |
| `ANTHROPIC_API_KEY` | No | — | API key para el extractor real |
| `EXTRACTOR_MODEL` | No | `claude-sonnet-4-6` | Modelo del extractor real |
| `ARCA_MODE` | No | `mock` | `mock` \| `ws` (ws requiere certificado, ver abajo) |
| `ARCA_CERT_PATH` / `ARCA_KEY_PATH` | No | — | Certificado X.509 + clave privada (PEM) emitidos por ARCA |
| `ARCA_CUIT` | No | — | CUIT representado ante el WS |
| `ARCA_ENV` | No | `homo` | `homo` \| `prod` |
| `INBOUND_EMAIL_SECRET` | No | — | Habilita el webhook de email entrante (sin esto responde 503) |
| `INBOUND_EMAIL_DOMAIN` | No | `pnl.example.com` | Dominio mostrado en la dirección `comprobantes+{slug}@…` |
| `TELEGRAM_BOT_TOKEN` | No | — | Habilita el bot real (sin esto el canal queda deshabilitado, salvo payloads mock) |
| `TELEGRAM_WEBHOOK_SECRET` | No | — | Valida el header secreto del webhook de Telegram |
| `FILE_STORAGE` | No | `local` | `local` (carpeta `./storage`) — `s3` queda como interfaz futura |
| `FILE_STORAGE_DIR` | No | `./storage` | Carpeta de archivos originales (inmutables) |

**Sin ninguna variable opcional configurada la app es 100% funcional**: extractor y ARCA en mock determinístico, canales email/Telegram probables con payloads de ejemplo.

---

## Cómo activar cada integración real

### OCR con Anthropic
1. Conseguí una API key en console.anthropic.com.
2. `.env`: `EXTRACTOR_MODE=real` + `ANTHROPIC_API_KEY=sk-ant-…` (opcional `EXTRACTOR_MODEL`).
3. Reiniciá el **worker**. PDFs con capa de texto se mandan como texto (más barato); imágenes y escaneos van con visión. Las "instrucciones de extracción" por contraparte se inyectan al prompt automáticamente.

### ARCA (constatación de comprobantes, ex wscdc)
Trámites necesarios:
1. **Certificado digital**: generá un CSR y obtené un certificado X.509 asociado a tu CUIT en el portal de ARCA (Administrador de Relaciones de Clave Fiscal → WSASS para homologación).
2. **Alta del servicio**: autorizá el web service *Constatación de Comprobantes* (`wscdc`) para ese certificado/CUIT.
3. `.env`: `ARCA_MODE=ws`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_CUIT`, `ARCA_ENV=homo` (probá en homologación primero).

Estado del código: `lib/arca/ws.ts` trae el esqueleto completo (TRA, llamada SOAP a `ComprobanteConstatar`, parseo de respuesta y mapeo de códigos de comprobante). **Falta la firma CMS/PKCS#7 del ticket WSAA** (marcada con `// TODO: requiere certificado ARCA`): implementala con `openssl smime -sign -outform DER -nodetach` vía child process o una librería PKCS#7. Sin eso, el modo `ws` degrada a `ERROR_CONSULTA` sin romper nada.

### Email entrante
1. `.env`: `INBOUND_EMAIL_SECRET=<un secreto largo>`.
2. Configurá un proveedor de inbound email (Postmark, SES+Lambda, Mailgun) para que postee el JSON del mensaje a `POST https://tu-dominio/api/inbound-email` con header `X-Inbound-Secret: <secreto>` (formato Postmark: `MessageID`, `From`, `To`, `Attachments[{Name, ContentType, Content}]`).
3. Cada empresa recibe en `comprobantes+{slug}@tu-dominio` (configurá el catch-all del dominio en el proveedor). El webhook deduplica por `MessageID`.

Prueba sin proveedor (mock):
```bash
curl -X POST http://localhost:3000/api/inbound-email \
  -H 'Content-Type: application/json' -H 'X-Inbound-Secret: <tu-secreto>' \
  -d '{"MessageID":"m1","From":"admin@demo.test","To":"comprobantes+empresa-alfa@pnl.example.com",
       "Attachments":[{"Name":"f.pdf","ContentType":"application/pdf","Content":"<base64 del PDF>"}]}'
```

### Telegram
1. Creá el bot con **@BotFather** (`/newbot`) y copiá el token → `TELEGRAM_BOT_TOKEN`.
2. Registrá el webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-dominio/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
3. En la app: Configuración → Telegram → *Generar código*. En el chat del bot: `/vincular {código}`. Desde ahí, cada foto/PDF que mande ese chat entra al pipeline de esa empresa (deduplicado por `update_id`; el bot confirma recepción).

Prueba sin token (mock): mandá un update con el archivo inline:
```bash
curl -X POST http://localhost:3000/api/telegram -H 'Content-Type: application/json' \
  -d '{"update_id":1,"message":{"chat":{"id":123},"text":"/vincular ALFA1234"}}'
curl -X POST http://localhost:3000/api/telegram -H 'Content-Type: application/json' \
  -d '{"update_id":2,"message":{"chat":{"id":123},"document":{"file_id":"x","file_name":"f.pdf","mime_type":"application/pdf"},"_mock_file_base64":"<base64>"}}'
```

---

## Criterios de aceptación (doc 10) — resultado de la verificación

Verificados sobre la base seedeada, con `EXTRACTOR_MODE=mock`, `ARCA_MODE=mock`, sin token de Telegram ni proveedor de email. Los criterios 3–11 se ejercitan con `npx tsx scripts/verify-acceptance.ts`; el 1 además con `npm test` (suite de integración) y el 1, 2 y 12 por HTTP.

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Aislamiento multi-empresa | ✅ | 8 tests de integración (`tests/aislamiento-empresa.test.ts`): lecturas, `findUnique`, `update`, `delete`, `updateMany`, `create` forzado y líneas hijas nunca cruzan empresas. Por HTTP: export de una empresa ajena → **403**; navegación → pantalla 403. |
| 2 | Permisos por rol | ✅ | El operador (Cargador) puede subir, pero `/maestros` y `/periodos` lo redirigen a 403 aunque fuerce la URL (revalidado en servidor); su export de movimientos devuelve solo sus cargas (8 filas vs 28 del admin). |
| 3 | Captura + OCR + asignación | ✅ | PDF ingresta → extracción mock lee el comprobante → matchea contraparte, propone categoría y distribución default → validado con **60% BPO / 40% SF** (60% con cliente Telecom): importes por línea $-72.600 / $-48.400, suman el total exacto. |
| 4 | Doble dimensión | ✅ | Filtro por cliente/proyecto en `/movimientos` (y en el script: 3 movimientos validados de Cliente Telecom con total asignado por línea). |
| 5 | ARCA | ✅ | Comprobante con CAE pasa por constatación mock y muestra badge; el INVALIDO (CAE termina en 00) **bloquea** la validación sin la confirmación explícita, y la confirmación queda en auditoría (`arcaInvalidoConfirmadoPorValidador`). |
| 6 | Duplicados | ✅ | La segunda subida de la misma factura (CUIT+tipo+PV+número) sale con alerta prominente apuntando al movimiento original (no bloquea). |
| 7 | Devengado + cierre | ✅ | Comprobante con fecha en mes cerrado quedó RETENIDO; validar en mes cerrado falla; un Admin reabre (auditado con motivo), se valida y se vuelve a cerrar. |
| 8 | Cierre con pendientes | ✅ | Cerrar el mes actual falla con mensaje que cuantifica los pendientes/observados; la pantalla de períodos los lista y linkea. |
| 9 | Recurrentes | ✅ | "Generar recurrentes del mes" creó Honorarios Legales pendiente y salteó Sueldos BPO (idempotente); Sueldos copia el importe del mes anterior. |
| 10 | Ventas | ✅ | Venta manual de $605.000 reflejada de inmediato en el mini-resumen de ingresos. |
| 11 | Anulación | ✅ | Anulado con motivo obligatorio: salió de los totales (egresos −$121.000), quedó en historial y auditoría, no se borró. |
| 12 | Canales | ✅ | Webhook email: secret inválido → 401; payload de ejemplo → comprobante en la empresa correcta (slug del destinatario); replay → deduplicado. Telegram: `/vincular ALFA1234` vinculó el chat y un documento mock entró al pipeline de Alfa con `canal=TELEGRAM`. |
| 13 | Sin credenciales | ✅ | Todo lo anterior corrió en mock, sin una sola credencial externa. |

---

## Decisiones tomadas (no especificadas, criterio conservador)

- **403**: las mutaciones, exports y APIs devuelven HTTP 403 real; la **navegación** de páginas redirige a una pantalla `/403` (limitación de App Router para setear status en páginas). El backend revalida siempre con `requireEmpresa`, nunca solo ocultando botones.
- **Cliente de datos scoped**: `requireEmpresa` devuelve un Prisma extendido que inyecta `empresaId` en cada query, fuerza la empresa activa en cada `create` y proteje las operaciones por clave única con un guard previo. `upsert` está deshabilitado en ese cliente (semántica insegura de re-scope).
- **Anulación ampliada**: además de `VALIDADO → ANULADO`, se permite anular pendientes/observados/retenidos — necesario para "resolver" un mes antes de cerrarlo (doc 10) sin borrar nada. Anular exige motivo y período abierto.
- **Creador en canales sin sesión** (email/Telegram): se usa el usuario miembro cuyo email coincide con el remitente; si no hay match, el primer Administrador de la empresa.
- **Recurrentes idempotentes**: cada asiento generado guarda `flags.plantillaRecurrenteId`; regenerar el mes no duplica. "Importe del mes anterior" toma el último asiento **validado** de esa plantilla.
- **Mock extractor con marcador**: los PDFs del seed llevan una línea `PNL-MOCK:{json}`; el extractor mock la lee como si fuera OCR perfecto (determinístico para demo y tests). Archivos sin marcador generan datos plausibles derivados del SHA-256; un nombre de archivo que contenga `error` fuerza el camino de fallo/reintentos.
- **CSV**: una fila por **línea de asignación** (la doble dimensión queda directamente operable en Excel), separador `;`, decimales con coma, BOM UTF-8.
- **Postgres embebido**: ante un entorno sin Docker/root, `scripts/dev-db.sh` usa los binarios de `embedded-postgres` (el wrapper npm tiene un bug ESM, por eso el script llama a `initdb`/`pg_ctl` directo).
- **MovimientoLinea.origen** (`MANUAL`/`PRORRATEO`): campo reservado para el motor de prorrateos futuro, como pide el doc 06, sin migración posterior.
- La **moneda** se registra y no se convierte (doc 01); los importes de todas las monedas se suman nominalmente en los totales (igual que la planilla original).

## Limitaciones conocidas

- La firma CMS del ticket WSAA (modo `ARCA_MODE=ws`) es un punto de extensión documentado, no implementado.
- `FILE_STORAGE=s3` está definido en la interfaz pero sin implementación (LocalFileStorage cubre dev y deploy en una VM).
- PDF multipágina = un solo comprobante (el split automático es fast-follow declarado en doc 04).
- El visor PDF usa el visor nativo del navegador (zoom/rotación manual solo para imágenes).
- Sesiones JWT: un cambio de rol impacta al volver a consultar el servidor (cada request revalida contra la DB vía `requireEmpresa`, así que el acceso efectivo es siempre el actual).

## Fuera de alcance (backlog de la próxima etapa)

Explícitamente excluido del MVP (doc 01), el modelo ya lo contempla:

1. **Motor de prorrateos automáticos**: seat cost por headcount, OH Burden, Admin Burden, descuentos entre unidades (las líneas ya distinguen `MANUAL` vs `PRORRATEO`).
2. **Carga de headcount** por sector/mes (insumo del seat cost).
3. **Reportes P&L** formateados, comparativos, drill-down, dashboards y gráficos.
4. Conciliación de IVA / sub-libros IVA.
5. Tipo de cambio y conversión de moneda extranjera.
6. Flujo de caja, cobranzas, pagos, vencimientos, conciliación bancaria.
7. Lectura automática de comprobantes emitidos/recibidos desde ARCA.
8. WhatsApp como canal.
9. Reglas de clasificación avanzadas (más allá del default por contraparte).
10. Multi-tenancy comercial (planes/facturación para terceros).

## Estructura del proyecto

```
app/                    # rutas Next (App Router)
  (auth)/               # login, registro, invitaciones
  (app)/[empresaSlug]/  # carga, validacion, movimientos, asientos, maestros,
                        # periodos, config, auditoria (todo scoped por empresa)
  api/                  # auth, archivos, inbound-email, telegram
lib/
  auth/                 # Auth.js + passwords
  empresa/              # requireEmpresa + cliente Prisma scoped (aislamiento)
  checks/               # CUIT (mod 11), aritmética, fechas, duplicados
  movimientos/          # máquina de estados, tabla de signos, distribución 100%,
                        # capa de servicio (validar/anular/cerrar/recurrentes)
  extractor/            # DocumentExtractor: mock + Anthropic
  arca/                 # ArcaConstatacion: mock + esqueleto wscdc
  canales/              # email entrante + telegram
  storage/              # FileStorage local inmutable (interfaz S3-ready)
  jobs.ts  pipeline.ts  periodos.ts  audit.ts
prisma/                 # schema, seed, generador de PDFs demo
scripts/                # dev-db.sh (Postgres sin root), verify-acceptance.ts
tests/                  # 60 tests (lógica crítica + aislamiento integración)
worker.ts               # procesador de la cola de jobs
```
