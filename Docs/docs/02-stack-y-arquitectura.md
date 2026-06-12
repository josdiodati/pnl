# 02 — Stack y arquitectura

## Stack

- **Next.js 14+ (App Router) + TypeScript**, full-stack: UI + server actions / route handlers en el mismo proyecto.
- **PostgreSQL + Prisma** como ORM y fuente del esquema.
- **Auth.js (NextAuth)** con provider de credenciales (email + password, hash con bcrypt/argon2). Estructurado para sumar OAuth después.
- **Tailwind CSS + shadcn/ui** (o equivalente headless) para la UI. Limpia, densa, orientada a uso administrativo diario, responsive (la foto se carga desde el celular).
- **@anthropic-ai/sdk** para la extracción OCR/LLM, detrás de una interfaz `DocumentExtractor`.
- **Storage de archivos**: interfaz `FileStorage` con métodos `put(buffer, meta) → {key, hash}`, `get(key) → buffer`, `getSignedUrl(key) → url`, `exists(key)`. Implementación `LocalFileStorage` (carpeta `/storage`, fuera del control de versiones) para desarrollo; diseño compatible con un `S3FileStorage` futuro. Los originales son **inmutables**.
- **Cola de trabajos en base de datos** (sin Redis, para deploy simple): tabla `Job { id, empresaId, tipo, payload JSON, estado (queued|processing|done|failed), intentos, maxIntentos=3, proximoIntento, error, createdAt }`. Un worker la procesa con polling (`setInterval` en un proceso dedicado `worker.ts`, o un route handler invocado por cron). Backoff exponencial entre reintentos.

No agregar dependencias pesadas innecesarias. Preferí soluciones que permitan un deploy en una sola VM o un PaaS simple (Railway/Render/Fly) con Postgres gestionado.

## Estructura de proyecto sugerida

```
/app                     # rutas Next (App Router)
  /(auth)                # login, registro, invitaciones
  /(app)                 # app autenticada
    /[empresaSlug]       # contexto de empresa activa en la URL
      /carga             # dashboard de carga (home)
      /validacion        # cola + vista lado a lado
      /movimientos       # tabla con filtros
      /asientos          # asiento y venta manual, recurrentes
      /maestros          # categorías, CC, contrapartes, clientes/proyectos, distribuciones
      /periodos          # grilla del ejercicio, cierres
      /config            # empresa, usuarios, roles
      /auditoria         # solo admin
  /api
    /inbound-email       # webhook email entrante
    /telegram            # webhook bot Telegram
    /jobs                # disparador del worker (si se usa cron)
/lib
  /auth                  # helpers de sesión y permisos
  /empresa               # requireEmpresa(rolMinimo), contexto activo
  /extractor             # DocumentExtractor (anthropic + mock)
  /arca                  # ArcaConstatacion (ws + mock)
  /storage               # FileStorage (local + interfaz s3)
  /checks                # CUIT, aritmética, duplicados
  /movimientos           # máquina de estados, cálculo de líneas
/prisma
  schema.prisma
  seed.ts
/worker.ts               # procesador de la cola
/docs                    # estos documentos
README.md
```

## Principios de arquitectura

- **Aislamiento multi-empresa centralizado**: un único helper `requireEmpresa(req, rolMinimo)` resuelve la empresa activa, verifica que el usuario pertenece a ella con rol suficiente, y devuelve un cliente de datos ya "scoped". Ninguna query toca datos sin pasar por ahí. Tratar una fuga entre empresas como bug crítico.
- **Todo cambio relevante pasa por una capa de servicio** que además escribe `AuditLog`, no por queries sueltas en los componentes.
- **Integraciones externas detrás de interfaces** con doble implementación (real + mock) seleccionable por env. La app debe levantar y completar todos los flujos sin una sola credencial real.
- **Idempotencia en webhooks**: email y Telegram pueden reintentar; deduplicar por id de mensaje.

## Variables de entorno (documentar todas en README)

```
DATABASE_URL=
NEXTAUTH_SECRET=
ANTHROPIC_API_KEY=                 # si falta → EXTRACTOR_MODE=mock obligatorio
EXTRACTOR_MODE=real|mock           # default mock
ARCA_MODE=mock|ws                  # default mock
ARCA_CERT_PATH= ARCA_KEY_PATH= ARCA_CUIT= ARCA_ENV=homo|prod
INBOUND_EMAIL_SECRET=              # valida el webhook de email
TELEGRAM_BOT_TOKEN=                # si falta → canal Telegram deshabilitado
TELEGRAM_WEBHOOK_SECRET=
FILE_STORAGE=local|s3              # default local
```
