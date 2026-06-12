# 01 — Visión y alcance

## Qué es

Aplicación web multi-empresa para llevar el **P&L de gestión** (estado de resultados de uso interno, no balance contable legal) de un grupo de empresas argentinas. Reemplaza una planilla Excel donde hoy se carga a mano cada movimiento, se clasifica contra un maestro de proveedores y se asignan costos a centros de costo (BPO, SF, Administración).

El salto respecto del Excel es la **captura**: subir comprobantes (PDF/foto/email/Telegram), que un LLM haga OCR y extraiga los datos, validarlos contra ARCA, clasificarlos automáticamente por proveedor y asignarlos a centros de costo y clientes/proyectos —incluso de forma porcentual— con una cola de validación humana rápida y trazabilidad total del número al documento original.

## A quién sirve

- Hoy: el grupo de empresas del usuario (varias empresas, un mismo usuario operando sobre todas).
- Mañana: terceros (otras organizaciones) usando la misma plataforma de forma aislada. El diseño multi-tenant debe contemplarlo desde el día 1 aunque la gestión de planes/facturación de terceros no se construya ahora.

## Criterio contable base

- **Devengado**: cada movimiento se imputa al mes de la fecha de su comprobante/devengamiento, no al de su pago.
- Sin condiciones financieras por ahora: no hay flujo de caja, cobranzas, pagos, vencimientos ni tipo de cambio. Se registra la moneda pero no se convierte.
- Nada se borra: se anula con motivo y queda en el historial.
- Nada impacta el resultado sin pasar por validación humana.

## DENTRO del alcance (MVP)

- Multi-empresa con un usuario operando varias empresas, roles por empresa, aislamiento estricto de datos.
- Maestros por empresa: categorías (plan de cuentas de gestión), centros de costo, contrapartes (proveedores/clientes), clientes/proyectos, plantillas de distribución.
- Captura de comprobantes por **upload web, foto, email entrante y Telegram**; pipeline OCR/LLM asíncrono; checks deterministas; cola de validación lado a lado.
- Constatación de comprobantes contra **ARCA** (modo mock por defecto, esqueleto real documentado).
- **Doble dimensión de análisis por movimiento: centro de costo + cliente/proyecto**, con **asignación porcentual** (1..N líneas que suman 100%).
- Asientos manuales (sueldos, impuestos, ajustes), ventas manuales, plantillas recurrentes.
- Períodos mensuales con cierre y reapertura controlada por rol.
- Auditoría completa.
- Vista mínima de movimientos para verificar la data (tabla con filtros + totales + export CSV). **Sin** P&L formateado ni gráficos.

## FUERA del alcance (etapas futuras — no construir, pero no cerrarles la puerta en el modelo)

- Motor de **prorrateos automáticos**: seat cost por headcount, OH Burden, Admin Burden, descuentos entre unidades. (Es la lógica más distintiva de la planilla original, pero se hace sobre data ya capturada; va después.)
- Carga de **headcount** por sector/mes (insumo del seat cost).
- **Reportes P&L** formateados, comparativos, drill-down visual, dashboards, gráficos.
- Conciliación de IVA / sub-libros IVA.
- Tipo de cambio y movimientos en moneda extranjera convertidos.
- Flujo de caja, cobranzas, pagos, vencimientos, conciliación bancaria.
- Integración ARCA para **leer** comprobantes emitidos/recibidos automáticamente (acá ARCA solo se usa para **constatar** un comprobante ya cargado).
- WhatsApp como canal (se eligió Telegram en su lugar).
- Reglas de clasificación automática avanzadas (más allá del default por contraparte).
- Gestión de planes/facturación para terceros (multi-tenant comercial).

## Contexto del negocio real (para que las decisiones tengan sentido)

Las empresas tienen unidades de negocio que **generan ingresos** (en el caso real: BPO y SF, un negocio de tercerización de procesos) y un área de **soporte** (Administración) cuyos costos luego se distribuyen sobre las unidades de negocio. El rubro de egreso más grande son **sueldos y cargas sociales** (~60%), que no nacen de facturas de proveedor sino de asientos manuales. Hay costos compartidos (alquiler de oficina, servicios, IT) que se reparten entre unidades — de ahí la necesidad central de la asignación porcentual. Saber el costo por **cliente/proyecto** importa porque el negocio factura por cuenta de cliente.
