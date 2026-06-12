# Construcción de la aplicación "P&L Manager" — Punto de partida

Sos el agente que va a construir esta aplicación de cero en un solo proyecto. Leé **todos** los documentos de `docs/` antes de escribir código, en este orden:

1. `docs/01-vision-y-alcance.md` — qué es, qué entra y qué NO entra al MVP.
2. `docs/02-stack-y-arquitectura.md` — decisiones técnicas y estructura del proyecto.
3. `docs/03-modelo-de-datos.md` — entidades, relaciones, esquema Prisma de referencia.
4. `docs/04-captura-y-ocr.md` — ingesta de comprobantes, canales, pipeline LLM, checks.
5. `docs/05-arca-constatacion.md` — validación de comprobantes contra ARCA.
6. `docs/06-asignacion-y-dimensiones.md` — centros de costo, cliente/proyecto, distribución porcentual.
7. `docs/07-movimientos-periodos-cierres.md` — máquina de estados, devengado, períodos.
8. `docs/08-roles-multiempresa-auditoria.md` — permisos, multi-empresa, audit trail.
9. `docs/09-pantallas-y-ux.md` — navegación y pantallas.
10. `docs/10-seed-y-criterios-aceptacion.md` — datos de ejemplo y checklist de verificación final.

## Cómo trabajar

- Idioma de toda la UI y los textos: **español (Argentina)**. Código y comentarios en inglés.
- Construí en este orden de prioridad, de mayor a menor. Si te quedás sin tiempo, recortá desde abajo, **nunca** desde arriba:
  1. Modelo de datos + auth + multi-empresa con aislamiento estricto.
  2. Maestros (categorías, centros de costo, contrapartes, clientes/proyectos).
  3. Captura de comprobantes con OCR + cola de validación + asignación de centros de costo (incluida la porcentual con doble dimensión).
  4. Asientos manuales, ventas manuales, plantillas recurrentes y de distribución.
  5. Períodos y cierres con devengado.
  6. Constatación ARCA (mock por defecto).
  7. Canales email + Telegram (webhook, modo mock/documentado).
  8. Vista de movimientos (reporting mínimo).
  9. Auditoría visual y export.
- Todo lo que dependa de credenciales externas (ARCA, email entrante, Telegram, LLM) debe tener **modo mock activable por env** para que la app corra de punta a punta sin ninguna credencial real. Documentá en el `README.md` final exactamente qué hay que configurar para activar cada integración.
- Escribí tests de la lógica crítica: validación de CUIT, checks aritméticos, detección de duplicados, máquina de estados de movimientos, suma de porcentajes de distribución = 100, y control de acceso multi-empresa.
- Al terminar, recorré uno por uno los criterios de aceptación de `docs/10` y dejá en el README el resultado de cada uno.

## Principio rector

La prioridad del MVP es **capturar datos de forma sencilla y confiable, y asignarlos a centros de costo y clientes/proyectos**. Los reportes elaborados y los prorrategos automáticos (seat cost, burdens) están **explícitamente fuera de alcance**. Ante una disyuntiva, elegí la opción que proteja la integridad del dato, el aislamiento entre empresas y la trazabilidad, por encima del pulido visual.
