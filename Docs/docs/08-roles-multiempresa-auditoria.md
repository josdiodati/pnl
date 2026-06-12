# 08 — Roles, multi-empresa y auditoría

## Multi-empresa (lo más crítico de la seguridad)

- Un **Usuario** pertenece a 1..N **Empresas** vía `UsuarioEmpresa`, con un **rol por empresa** (puede ser Admin en una y Cargador en otra).
- **Selector de empresa activa** siempre visible en el header; la empresa activa va en la URL (`/[empresaSlug]/...`). Cambiarla cambia todo el contexto sin re-login.
- **Aislamiento estricto**: todo acceso a datos pasa por `requireEmpresa(req, rolMinimo)`, que:
  1. resuelve la empresa activa de la URL/sesión,
  2. verifica que el usuario pertenece a ella,
  3. verifica que su rol ≥ el mínimo requerido,
  4. devuelve un contexto/cliente ya filtrado por `empresaId`.
- Un request a una empresa donde el usuario no está → **403**. Un dato de otra empresa **nunca** puede aparecer. Esto es el criterio de aceptación #1 y se testea.
- Crear empresa: cualquier usuario puede; queda Admin de ella. Invitar usuarios por email con rol (tabla `Invitacion`, token de un solo uso).

## Roles y permisos (por empresa)

| Acción | Cargador | Validador | Administrador |
|---|:---:|:---:|:---:|
| Subir comprobantes / crear borradores | ✔ | ✔ | ✔ |
| Ver sus propias cargas | ✔ | ✔ | ✔ |
| Ver todos los movimientos | — | ✔ | ✔ |
| Validar / corregir / observar / anular | — | ✔ | ✔ |
| Editar maestros | — | ✔ | ✔ |
| Generar recurrentes del mes | — | ✔ | ✔ |
| Cerrar períodos | — | ✔ | ✔ |
| **Reabrir períodos cerrados** | — | — | ✔ |
| Confirmar validación de comprobante ARCA-inválido | — | ✔ | ✔ |
| Gestionar usuarios / invitaciones | — | — | ✔ |
| Editar datos de la empresa | — | — | ✔ |
| Ver auditoría | — | — | ✔ |

Aplicar los permisos **en el servidor** (no solo ocultando botones). La UI esconde lo que el rol no puede, pero el backend siempre revalida.

## Auditoría

- `AuditLog` registra: alta/edición/validación/observación/anulación de movimientos, cambios de maestros, generación de recurrentes, cierres y **reaperturas** de períodos (con motivo), altas/cambios de usuarios y roles, vínculos de Telegram.
- Guardar `antes`/`despues` en JSON para los cambios de campos.
- Cada movimiento muestra su **historial** en un panel: "cargado por X el Y vía Telegram → procesado → validado por Z (cambió total de A a B) → ...".
- Adjuntos con **hash SHA-256** al ingresar; inmutables. Si se re-sube un archivo distinto, es un movimiento nuevo, no un reemplazo.
- Pantalla de auditoría (solo Admin): consulta filtrable por entidad, usuario, acción y fecha.
