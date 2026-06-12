# 03 — Modelo de datos

Esquema Prisma de referencia. Ajustá nombres/tipos si hace falta, pero respetá las relaciones, el scoping por empresa y las restricciones marcadas.

```prisma
// ---------- Identidad y multi-empresa ----------
model Usuario {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  nombre        String
  empresas      UsuarioEmpresa[]
  createdAt     DateTime @default(now())
}

model Empresa {
  id                   String   @id @default(cuid())
  slug                 String   @unique          // para URL y email/telegram
  razonSocial          String
  cuit                 String
  inicioEjercicioFiscal Int     @default(7)      // mes 1-12, default julio
  logoKey              String?
  usuarios             UsuarioEmpresa[]
  // ... todos los maestros y movimientos cuelgan de acá
  createdAt            DateTime @default(now())
}

enum Rol { CARGADOR VALIDADOR ADMINISTRADOR }

model UsuarioEmpresa {
  id         String  @id @default(cuid())
  usuarioId  String
  empresaId  String
  rol        Rol
  usuario    Usuario @relation(fields: [usuarioId], references: [id])
  empresa    Empresa @relation(fields: [empresaId], references: [id])
  @@unique([usuarioId, empresaId])
}

model Invitacion {
  id        String  @id @default(cuid())
  empresaId String
  email     String
  rol       Rol
  token     String  @unique
  aceptada  Boolean @default(false)
  createdAt DateTime @default(now())
}

// ---------- Maestros (todos scoped por empresa) ----------
enum TipoCategoria { INGRESO EGRESO }

model Categoria {
  id        String  @id @default(cuid())
  empresaId String
  nombre    String
  tipo      TipoCategoria
  padreId   String?            // jerarquía máx 2 niveles
  activa    Boolean @default(true)
  @@unique([empresaId, nombre])
}

enum TipoCentroCosto { NEGOCIO SOPORTE }

model CentroCosto {
  id        String  @id @default(cuid())
  empresaId String
  nombre    String
  tipo      TipoCentroCosto
  activo    Boolean @default(true)
  @@unique([empresaId, nombre])
}

// Segunda dimensión de análisis (opcional por línea)
model ClienteProyecto {
  id        String  @id @default(cuid())
  empresaId String
  nombre    String
  codigo    String?
  activo    Boolean @default(true)
  @@unique([empresaId, nombre])
}

enum TipoContraparte { PROVEEDOR CLIENTE AMBOS }

model Contraparte {
  id                    String  @id @default(cuid())
  empresaId             String
  cuit                  String
  razonSocial           String
  tipo                  TipoContraparte
  condicionIva          String?
  categoriaDefaultId    String?
  distribucionDefaultId String?            // plantilla de distribución por defecto
  instruccionesExtraccion String?          // correcciones recurrentes, se inyectan al prompt del LLM
  activa                Boolean @default(true)
  @@unique([empresaId, cuit])
}

// Plantilla de distribución reutilizable (ej. "Alquiler 60/30/10")
model PlantillaDistribucion {
  id        String  @id @default(cuid())
  empresaId String
  nombre    String
  lineas    PlantillaDistribucionLinea[]
  @@unique([empresaId, nombre])
}
model PlantillaDistribucionLinea {
  id            String  @id @default(cuid())
  plantillaId   String
  centroCostoId String
  clienteProyectoId String?
  porcentaje    Decimal @db.Decimal(7,4)   // suma de líneas = 100
}

// Plantilla recurrente (asiento mensual repetido: legales, sueldos, etc.)
model PlantillaRecurrente {
  id            String  @id @default(cuid())
  empresaId     String
  nombre        String
  categoriaId   String
  importeSugerido Decimal @db.Decimal(18,2)
  descripcion   String?
  diaDelMes     Int     @default(1)
  distribucionId String?               // plantilla de distribución asociada
  activa        Boolean @default(true)
}

// ---------- Movimientos ----------
enum OrigenMovimiento { COMPROBANTE ASIENTO_MANUAL VENTA_MANUAL }
enum EstadoMovimiento { INGRESADO PROCESANDO PENDIENTE_VALIDACION RETENIDO OBSERVADO VALIDADO ANULADO ERROR_PROCESAMIENTO }
enum Moneda { ARS USD EUR OTRA }

model Movimiento {
  id              String   @id @default(cuid())
  empresaId       String
  origen          OrigenMovimiento
  estado          EstadoMovimiento @default(INGRESADO)
  fechaDevengamiento DateTime?      // mes de imputación (devengado)
  categoriaId     String?
  contraparteId   String?
  descripcion     String?
  moneda          Moneda  @default(ARS)

  // Importes (positivos; el signo contable se deriva de categoría + tipoComprobante)
  netoGravado     Decimal? @db.Decimal(18,2)
  iva21           Decimal? @db.Decimal(18,2)
  iva105          Decimal? @db.Decimal(18,2)
  iva27           Decimal? @db.Decimal(18,2)
  percepcionesIva Decimal? @db.Decimal(18,2)
  percepcionesIibb Decimal? @db.Decimal(18,2)
  otrosTributos   Decimal? @db.Decimal(18,2)
  noGravadoExento Decimal? @db.Decimal(18,2)
  total           Decimal? @db.Decimal(18,2)

  // Datos de comprobante
  tipoComprobante String?
  puntoVenta      String?
  numero          String?
  cae             String?
  vencimientoCae  DateTime?

  // OCR / archivo
  archivoKey      String?
  archivoHash     String?
  extraccionRaw   Json?              // JSON crudo devuelto por el LLM
  camposRevisar   Json?              // qué campos quedaron en REVISAR
  confianza       Json?              // confianza por campo si está disponible

  // ARCA
  arcaEstado      String  @default("NO_VERIFICADO") // NO_VERIFICADO|VALIDO|INVALIDO|ERROR_CONSULTA
  arcaConsultadoAt DateTime?

  // Asignación (doble dimensión, porcentual)
  lineas          MovimientoLinea[]

  flags           Json?              // metadata futura (ej. el flag "I/O" pendiente de definir)
  periodoId       String?
  creadoPorId     String
  validadoPorId   String?
  motivoAnulacion String?
  canalIngreso    String?            // WEB | FOTO | EMAIL | TELEGRAM | MANUAL
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model MovimientoLinea {
  id               String  @id @default(cuid())
  movimientoId     String
  centroCostoId    String
  clienteProyectoId String?           // segunda dimensión, opcional
  porcentaje       Decimal @db.Decimal(7,4)   // suma por movimiento = 100.0000
  // importe derivado = total firmado * porcentaje/100 (calculado, no necesariamente persistido)
}

// ---------- Períodos ----------
enum EstadoPeriodo { ABIERTO CERRADO }
model Periodo {
  id        String  @id @default(cuid())
  empresaId String
  anio      Int
  mes       Int
  estado    EstadoPeriodo @default(ABIERTO)
  cerradoPorId String?
  cerradoAt DateTime?
  @@unique([empresaId, anio, mes])
}

// ---------- Infra ----------
model Job {
  id            String  @id @default(cuid())
  empresaId     String?
  tipo          String  // EXTRACCION | ARCA | RECURRENTES | EMAIL_IN | TELEGRAM_IN
  payload       Json
  estado        String  @default("queued")
  intentos      Int     @default(0)
  maxIntentos   Int     @default(3)
  proximoIntento DateTime?
  error         String?
  createdAt     DateTime @default(now())
}

model AuditLog {
  id         String  @id @default(cuid())
  empresaId  String
  usuarioId  String?
  entidad    String
  entidadId  String
  accion     String
  antes      Json?
  despues    Json?
  createdAt  DateTime @default(now())
}
```

## Reglas de integridad clave

- **Toda** entidad de datos lleva `empresaId` y toda query la filtra. Los `@@unique` por empresa garantizan que dos empresas puedan tener "BPO" sin chocar.
- Suma de `porcentaje` de las `MovimientoLinea` de un movimiento = **100.0000** exacto (validar en la capa de servicio; ajustar redondeo del último renglón).
- El **signo contable** se deriva al calcular, no se guarda: EGRESO resta, INGRESO suma; notas de crédito invierten respecto del comprobante base. Documentar la tabla de signos en `lib/movimientos`.
- Borrado físico **prohibido** en Movimiento, Contraparte, Categoria, CentroCosto, ClienteProyecto: usar `activo/anulado`.
- `ClienteProyecto` es **opcional** por línea (hay costos sin cliente). `CentroCosto` es **obligatorio** por línea.
