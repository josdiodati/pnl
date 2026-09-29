# Reportes personalizados — diseño

Fecha: 2026-09-29 · Estado: aprobado en conversación, pendiente revisión del spec escrito

## Objetivo

Una sección nueva, **Reportes personalizados**, separada de *Reportes* (P&L).
Contiene reportes armados a medida, a pedido de un usuario, que pueden mirar la
misma información desde otra perspectiva. Para no sobrecargar a todos con todo,
cada reporte se habilita **por usuario y por empresa** desde Configuración. Un
reporte pedido por una persona puede habilitarse a otras que también lo quieran.

Éxito:
- Un administrador ve en Configuración el catálogo de reportes (título,
  descripción, rol mínimo, pedido por) y marca qué usuarios de la empresa
  ven cada uno.
- Cada usuario ve en el menú sólo los reportes que tiene habilitados en esa
  empresa; si no tiene ninguno, la sección no aparece.
- Entrar por URL a un reporte no habilitado da 403.
- Agregar un reporte nuevo = escribir su página + una entrada en el catálogo,
  sin migración.

Fuera de alcance: armar reportes desde la UI, permisos genéricos para otras
secciones, reportes reales más allá del de ejemplo (se agregan uno por pedido).

## Decisiones

| # | Decisión |
|---|----------|
| R1 | Habilitación por (usuario, empresa), consistente con el rol que ya es por empresa. |
| R2 | Catálogo en código; la base guarda sólo las habilitaciones. |
| R3 | Sólo ADMINISTRADOR habilita/deshabilita (Configuración ya es sólo admin). |
| R4 | Cada reporte declara `rolMinimo`; no se puede habilitar a un usuario con rol inferior y, si el rol baja después, el acceso se pierde sin borrar la fila. |
| R5 | Filas cuyo `reporteId` ya no está en el catálogo se ignoran (no se borran). |
| R6 | Altas y bajas quedan en `AuditLog`. |
| R7 | Primera entrega: infraestructura + un reporte de ejemplo ("Gasto por proveedor"). |

## Datos

Tabla nueva (migración sin datos):

```prisma
model ReporteHabilitado {
  id            String   @id @default(cuid())
  empresaId     String
  usuarioId     String
  reporteId     String   // id del catálogo en código
  habilitadoPor String?  // usuarioId del admin
  createdAt     DateTime @default(now())
  empresa       Empresa  @relation(fields: [empresaId], references: [id])
  usuario       Usuario  @relation(fields: [usuarioId], references: [id])

  @@unique([usuarioId, empresaId, reporteId])
  @@index([empresaId])
}
```

## Catálogo — `lib/reportes-personalizados/catalogo.ts`

```ts
type ReportePersonalizado = {
  id: string;            // slug estable, usado en URL y en la base
  titulo: string;
  descripcion: string;   // 1–2 frases, se muestra en Configuración y en el índice
  rolMinimo: Rol;
  pedidoPor?: string;    // texto libre: quién lo pidió
};
export const CATALOGO: ReportePersonalizado[];
export function reporteDelCatalogo(id: string): ReportePersonalizado | undefined;
```

La página de cada reporte vive en
`app/(app)/[empresaSlug]/reportes-personalizados/<id>/page.tsx` (ruta estática
por reporte; el catálogo describe, la ruta implementa).

## Acceso — `lib/reportes-personalizados/acceso.ts`

- `puedeVerReporte({ reporte, rol, habilitado })` — función pura: reporte en
  catálogo ∧ fila existente ∧ `rolAlcanza(rol, reporte.rolMinimo)`.
- `reportesVisibles(ctx)` — lee las filas del usuario en la empresa y devuelve
  las entradas del catálogo que pasan `puedeVerReporte`, en el orden del
  catálogo. Lo usan el layout (menú) y el índice.
- `requireReportePage(slug, reporteId)` — `requireEmpresaPage` + chequeo; si no
  pasa, `redirect('/403')` como el resto de la app.

## Configuración

Tarjeta "Reportes personalizados" debajo de "Usuarios y roles" en
`/[empresa]/config`:

- Grilla: filas = reportes del catálogo (título, descripción, rol mínimo,
  pedido por); columnas = miembros de la empresa.
- Checkbox por celda con name `h:<reporteId>:<usuarioId>`; deshabilitado (gris,
  `title="Requiere <rol>"`) si el rol del miembro no alcanza.
- Un botón Guardar → `guardarReportesAction`:
  1. `requireEmpresa(slug, 'ADMINISTRADOR')`.
  2. Parsea el form a un set deseado; descarta pares inválidos (reporte fuera
     de catálogo, usuario no miembro, rol insuficiente).
  3. `diffHabilitaciones(actual, deseado, valido)` (pura) → `{ altas, bajas }`,
     sólo sobre celdas válidas: las filas huérfanas y las de usuarios cuyo rol
     ya no alcanza (casilla deshabilitada, no viaja en el form) no se borran
     — si le devuelven el rol, recupera el reporte (R4).
  4. En transacción: `createMany` altas, `deleteMany` bajas, `writeAudit` por
     cada una (`entidad: 'ReporteHabilitado'`, `accion: 'HABILITAR' |
     'DESHABILITAR'`, datos: reporteId + email).
  5. Vuelve con "Reportes actualizados".

## Menú e índice

- Layout: `reportesVisibles(ctx)`; si hay ≥1, sección "Reportes personalizados"
  con un ítem por reporte (`/[empresa]/reportes-personalizados/<id>`).
- `/[empresa]/reportes-personalizados`: tarjetas (título + descripción) de los
  visibles; si no hay ninguno, mensaje "No tenés reportes personalizados
  habilitados; pedíselos a un administrador".

## Reporte de ejemplo — `gasto-por-proveedor`

- Rol mínimo VALIDADOR. Pedido por: ejemplo inicial.
- Top 15 contrapartes por monto neto de compras (comprobantes de compra no
  anulados ni duplicados, mismos criterios que la vista Compras) en los últimos
  12 meses; columnas: proveedor, cantidad de comprobantes, neto total, % del
  total; fila "Resto" y total general.
- Cada monto/cantidad linkea a
  `/comprobantes?contraparteId=<id>&desde=<AAAA-MM-DD>&hasta=<AAAA-MM-DD>`
  (lado compras por defecto).
- Comprobantes sin contraparte (aún sin validar) se agrupan por el CUIT
  emisor extraído, con la razón social del documento, marcados "Sin validar ·
  CUIT …" y con drill-down `?q=<cuit>`. Sólo sin contraparte ni CUIT caen en
  "Sin identificar" (sin link). Ajuste de la implementación: en la base
  local los 325 comprobantes pendientes quedaban en una única fila.
- La agregación es una función pura testeable (`agruparGastoPorProveedor`).

## Pruebas

- `puedeVerReporte`: sin fila, rol insuficiente, fuera de catálogo, OK.
- `diffHabilitaciones`: altas, bajas, sin cambios, huérfanas intactas.
- Catálogo: ids únicos y con formato slug.
- `agruparGastoPorProveedor`: top N + resto + totales.
- Build + verificación en navegador local: habilitar, ver en menú, 403 sin
  permiso, drill-down a Comprobantes.

## Despliegue

Migración aditiva (`ReporteHabilitado`) + deploy habitual en pnlvm. Después
del deploy el usuario se habilita a sí mismo el reporte de ejemplo desde
Configuración.
