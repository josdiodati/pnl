# 10 — Seed y criterios de aceptación

## Seed (`prisma db seed`)

Dejar la app con vida al primer arranque. Documentar las credenciales demo en el README.

- **Usuarios**: un admin demo (`admin@demo.test` / password en README) y un segundo usuario `operador@demo.test`.
- **Empresas**: dos — "Empresa Alfa S.A." y "Empresa Beta S.R.L." — con `inicioEjercicioFiscal = 7` (julio). El admin demo pertenece a **ambas** con roles distintos (Administrador en Alfa, Validador en Beta) para poder probar el switcher y los permisos. El operador es Cargador en Alfa.
- **Maestros (por empresa, inspirados en el caso real)**:
  - Categorías de ingreso: Ventas BPO, Ventas SF, Ventas HW. De egreso: Sueldos, Adicionales Salarios, IT & COM Services, Office Supplies, Office Expenditure, Legales, Contables, Representación, Impuestos, Gastos Bancarios, Misceláneos.
  - Centros de costo: **BPO** (negocio), **SF** (negocio), **Administración** (soporte).
  - Clientes/proyectos: 3-4 de ejemplo (ej. "Cliente Telecom", "Cliente Retail", "Interno").
  - ~10 contrapartes con **CUITs válidos** (dígito verificador correcto), algunas con categoría y distribución default.
  - 2 plantillas de distribución (ej. "Alquiler 60/30/10", "IT 70/20/10").
  - 2 plantillas recurrentes (ej. "Honorarios Legales" importe fijo, "Sueldos BPO" con importe del mes anterior).
- **Movimientos**: ~15 repartidos en 3 meses consecutivos, en distintos estados (validados, pendientes, uno observado, uno anulado con motivo, uno retenido en un mes cerrado), con distintos orígenes (comprobante, asiento manual, venta manual) y algunos con **distribución porcentual de doble dimensión**. Uno de los 3 meses debe estar **CERRADO**.
- **Archivos**: para los movimientos de origen comprobante, incluir 2-3 PDFs/imágenes de factura de ejemplo (pueden ser generados o de placeholder) para probar el visor.

## Criterios de aceptación (verificar uno por uno antes de cerrar; dejar el resultado en el README)

1. **Aislamiento multi-empresa**: el admin demo cambia entre Alfa y Beta y los datos nunca se mezclan; un request manipulado hacia una empresa donde no pertenece devuelve 403.
2. **Permisos por rol**: el operador (Cargador en Alfa) puede subir pero no ve la cola de validación de otros, no edita maestros ni cierra períodos; el backend rechaza esas acciones aunque se fuercen.
3. **Captura + OCR + asignación**: subo un PDF → se procesa (mock o real) → aparece en la cola con campos extraídos y checks marcados → lo valido repartiendo **60% BPO / 40% SF**, uno de ellos con cliente/proyecto → aparece en Movimientos con los importes por línea correctos y sumando el total.
4. **Doble dimensión**: puedo filtrar movimientos por cliente/proyecto y ver su total.
5. **ARCA**: un comprobante con CAE pasa por constatación (mock), muestra badge; uno marcado INVALIDO exige confirmación extra para validarse, y esa confirmación queda en auditoría.
6. **Duplicados**: subo dos veces la misma factura (mismo CUIT+tipo+PV+número) → la segunda muestra alerta de duplicado.
7. **Devengado + cierre**: un comprobante con fecha en mes cerrado queda RETENIDO; un Admin reabre (auditado con motivo), se valida, se vuelve a cerrar.
8. **Cierre con pendientes**: no puedo cerrar un mes con movimientos pendientes; la pantalla me lista qué resolver.
9. **Recurrentes**: "generar recurrentes del mes" crea los asientos precargados en la cola.
10. **Ventas**: cargo una venta manual y el mini-resumen de ingresos la refleja.
11. **Anulación**: anulo un movimiento validado con motivo → sale de los totales, queda en historial y auditoría, no se borra.
12. **Canales**: el webhook de email y el de Telegram aceptan un payload de ejemplo (modo mock/secret) e inyectan un comprobante al pipeline asociado a la empresa correcta.
13. **Sin credenciales**: toda la app corre de punta a punta con `EXTRACTOR_MODE=mock`, `ARCA_MODE=mock`, sin token de Telegram ni proveedor de email reales. El README explica qué configurar para activar cada integración real, más setup, env, seed y deploy.

## README final (obligatorio)
Incluir: requisitos, setup paso a paso, variables de entorno (todas, con cuáles son obligatorias y cuáles opcionales), cómo correr seed, cómo levantar app + worker, credenciales demo, cómo activar cada integración real (Anthropic, ARCA con qué tramitar, email entrante, Telegram con BotFather), limitaciones conocidas, y el alcance explícitamente excluido (prorrateos, reportes, headcount, etc.) para que quede claro qué es la próxima etapa.
