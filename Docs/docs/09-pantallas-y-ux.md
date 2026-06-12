# 09 — Pantallas y UX

UI en español (Argentina), limpia y densa, pensada para uso administrativo diario. Responsive: la carga por foto y el visor deben funcionar en celular.

## Navegación (todo bajo la empresa activa `/[empresaSlug]`)

1. **Login / registro / aceptar invitación** — fuera del contexto de empresa.
2. **Selector de empresa** — pantalla post-login si el usuario tiene varias; switcher permanente en el header (con el rol del usuario en esa empresa visible).
3. **Dashboard de carga** (home) — zona de drag & drop + botón de foto; tarjetas de estado del pipeline: Ingresados, Procesando, Pendientes de validación, Retenidos, Observados, Errores, cada una clickeable hacia su lista. Es la pantalla a la que se entra siempre.
4. **Cola de validación** — lista filtrable + vista lado a lado (documento original | formulario). Campos en REVISAR resaltados, alertas de duplicado y ARCA. "Validar y siguiente". (Detalle en doc 04.)
5. **Movimientos** — tabla con filtros (período/fechas, categoría, centro de costo, cliente/proyecto, contraparte, origen, estado, canal), totales de la selección al pie, mini-resumen arriba (ingresos / egresos / resultado + desglose por centro de costo), export CSV. **Sin gráficos ni P&L formateado.** (Detalle en doc 10/01.)
6. **Asientos** — alta de asiento manual y de venta manual; gestión de **plantillas recurrentes** y botón "generar recurrentes del mes".
7. **Maestros** — categorías (con jerarquía y tipo), centros de costo, **clientes/proyectos**, contrapartes (con su categoría y distribución default e instrucciones de extracción), plantillas de distribución.
8. **Períodos** — grilla del ejercicio fiscal (12 meses) con estado, total validado por mes, cerrar/reabrir según rol.
9. **Configuración de empresa** — datos de la empresa, usuarios y roles, invitaciones, **código de vínculo de Telegram** y dirección de email entrante de la empresa.
10. **Auditoría** — solo Admin, consulta filtrable.

## Detalles de UX que importan

- **Velocidad de validación**: el caso feliz (comprobante bien extraído, contraparte conocida, un solo centro de costo) debe resolverse con un único click ("validar y siguiente"). Todo lo demás es la excepción.
- **Visor de documentos**: zoom, multipágina, rotación. Imprescindible para validar mirando el papel.
- **Estados siempre visibles**: que el usuario sepa en todo momento cuántos comprobantes esperan algo de él.
- **Carga masiva**: soltar 30 PDFs y que la cola los vaya resolviendo sin trabar la UI.
- **Mobile**: sacar foto, ver estado, validar lo simple. La operación pesada se hace en desktop.
- **Errores claros**: si el OCR falló o ARCA dio error, decir qué pasó y ofrecer la acción (reintentar / cargar a mano).

## Tono visual
Sobrio y profesional, alta legibilidad de números (tabular nums, alineación a la derecha en importes), buen uso de color solo para estados (verde validado, amarillo revisar, rojo alerta/anulado, gris no verificado). Nada de adornos: es una herramienta de trabajo.
