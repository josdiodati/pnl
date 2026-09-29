# Reportes personalizados — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Pasos con checkbox.

**Goal:** Sección "Reportes personalizados" con catálogo en código y habilitación por (usuario, empresa) desde Configuración, más el reporte de ejemplo "Gasto por proveedor".

**Architecture:** Catálogo estático en `lib/reportes-personalizados/catalogo.ts`; tabla `ReporteHabilitado` (scoped por empresa) con las habilitaciones; un helper de acceso usado por layout, índice y cada página; grilla de checkboxes en `/config` con server action que aplica un diff y audita.

**Tech Stack:** Next.js 14 (app router, server actions), Prisma (`db push`, sin carpeta de migraciones), Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-reportes-personalizados-design.md`

## Global Constraints

- Habilitación por (usuarioId, empresaId, reporteId); sólo ADMINISTRADOR edita.
- Acceso = en catálogo ∧ fila ∧ `rolAlcanza(rol, rolMinimo)`; sin acceso → `redirect('/403')`.
- Filas huérfanas (reporte fuera de catálogo) se ignoran y no se borran.
- Altas/bajas → `writeAudit` con `entidad: 'ReporteHabilitado'`, `accion: 'HABILITAR' | 'DESHABILITAR'`.
- Drill-down a `/comprobantes` (no a Ventas).
- Nada de archivos en server actions (no aplica: sólo checkboxes).

## Review Focus

- Admin guarda la grilla con un usuario cuyo rol no alcanza (form manipulado) → el par se descarta, no se crea fila. Test en `diffHabilitaciones`/`parsearGrilla`.
- Fila huérfana de un reporte removido → no aparece en menú ni se borra al guardar. Test en `diffHabilitaciones` y `puedeVerReporte`.
- Usuario de otra empresa con fila en E1 entra a E2 → no ve el reporte (scoped db por empresa). Cubierto por `reportesVisibles` usando `ctx.db`.
- Proveedor sin contraparte identificada → fila "Sin identificar" sin link. Test en `agruparGastoPorProveedor`.
- Nota de crédito / moneda extranjera sin tipo de cambio → resta / se cuenta aparte, igual que Compras. Test en `agruparGastoPorProveedor`.

---

### Task 1: Esquema y scope

**Files:** Modify `prisma/schema.prisma`, `lib/empresa/scope.ts`, `tests/scope-membership.test.ts`

- [ ] Agregar modelo `ReporteHabilitado` (spec §Datos) y relaciones inversas `reportesHabilitados ReporteHabilitado[]` en `Usuario` y `Empresa`.
- [ ] Agregar `'ReporteHabilitado'` a `SCOPED_MODELS`; test de membresía.
- [ ] `npx prisma generate && npx prisma db push` en local; `npm test`.
- [ ] Commit.

### Task 2: Catálogo y acceso (TDD)

**Files:** Create `lib/reportes-personalizados/catalogo.ts`, `lib/reportes-personalizados/acceso.ts`, `tests/reportes-personalizados.test.ts`

**Produces:**
- `type ReportePersonalizado = { id; titulo; descripcion; rolMinimo: Rol; pedidoPor?: string }`
- `CATALOGO: ReportePersonalizado[]`, `reporteDelCatalogo(id)`
- `puedeVerReporte(reporteId: string, rol: Rol, habilitados: Set<string>): boolean`
- `diffHabilitaciones(actual: Par[], deseado: Par[], validos: (p: Par) => boolean): { altas: Par[]; bajas: Par[] }` con `Par = { usuarioId; reporteId }`; `bajas` sólo de reportes en catálogo.
- `parsearGrilla(form: FormData): Par[]` (names `h:<reporteId>:<usuarioId>`).
- `reportesVisibles(ctx: EmpresaContext): Promise<ReportePersonalizado[]>`
- `requireReportePage(slug, reporteId): Promise<EmpresaContext>`

- [ ] Tests: ids únicos y slug; puedeVerReporte (sin fila, rol bajo, fuera de catálogo, ok); diff (altas, bajas, sin cambios, huérfanas intactas, inválidos descartados); parsearGrilla.
- [ ] Ver fallar, implementar, ver pasar. Commit.

### Task 3: Reporte "Gasto por proveedor" (TDD)

**Files:** Create `lib/reportes-personalizados/gasto-por-proveedor.ts`, `app/(app)/[empresaSlug]/reportes-personalizados/gasto-por-proveedor/page.tsx`; test en `tests/reportes-personalizados.test.ts`

**Produces:** `agruparGastoPorProveedor(filas, topN=15): { filas: {contraparteId: string|null; proveedor; cantidad; netoArs; pct}[]; resto: {cantidad; netoArs} | null; total: {cantidad; netoArs}; sinTipoCambio: number }` — neto = total − IVA − percepciones − otros tributos, pesificado, NC resta (misma cuenta que `resumirComprobantes`).

- [ ] Tests: top N + resto, NC resta, sin TC contado aparte, sin contraparte agrupado como "Sin identificar".
- [ ] Página: `requireReportePage`, where = `buildWhereComprobantes({ lado: 'compras', desde, hasta }, { esValidador: true, usuarioId })` últimos 12 meses; tabla con links a `/comprobantes?contraparteId=&desde=&hasta=`.
- [ ] Commit.

### Task 4: Índice, menú y Configuración

**Files:** Create `app/(app)/[empresaSlug]/reportes-personalizados/page.tsx`; Modify `app/(app)/[empresaSlug]/layout.tsx`, `app/(app)/[empresaSlug]/config/page.tsx`, `app/(app)/[empresaSlug]/config/actions.ts`

- [ ] Índice con tarjetas o mensaje vacío.
- [ ] Layout: sección "Reportes personalizados" si `reportesVisibles` ≠ ∅.
- [ ] Config: tarjeta grilla; `guardarReportesAction` (requireEmpresa ADMIN → parsearGrilla → diff con validez por catálogo+membresía+rol → transacción createMany/deleteMany + writeAudit → volver 'Reportes actualizados').
- [ ] typecheck, tests, build; verificación en navegador local (habilitar, menú, 403, drill-down). Commit.

### Task 5: Deploy

- [ ] Merge a master, push, runbook de deploy (rsync + `prisma db push` + build + restart), verificar servicios.
