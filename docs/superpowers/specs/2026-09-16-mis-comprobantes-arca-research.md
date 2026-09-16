# Mis Comprobantes de ARCA en PNL — investigación y plan

Fecha: 16-sep-2026. Estado: investigación (sin código). Autor: sesión de Claude Code a pedido de José.

## 1. Qué queremos

Traer a PNL, todos los días, el listado de comprobantes **emitidos** y **recibidos** que ARCA registra para cada empresa (Kawellu, Ewwo), para:

1. Chequear que todo comprobante emitido/recibido esté contabilizado en el libro (faltantes).
2. Dar por **válido** un comprobante cargado si figura en el listado de ARCA, reemplazando la constatación por web service (`wscdc`) que hoy corre en modo mock.

El reporte vive en el servicio **"Mis Comprobantes"** del portal con Clave Fiscal. **No existe web service oficial** para este reporte: sólo se obtiene navegando el portal. Por eso todas las soluciones existentes (AfipSDK incluida) son automatización de navegador con la Clave Fiscal del contribuyente.

## 2. Qué hace AfipSDK (afipsdk.com)

AfipSDK vende dos cosas: wrappers de los web services oficiales (WSAA/WSFE/padrón, etc.) y **"automatizaciones"**: tareas que sólo se pueden hacer a mano en el portal, ejecutadas en sus servidores.

**Automatización `mis-comprobantes`** (blog: afipsdk.com/blog/descargar-mis-comprobantes-de-arca-via-api/):

```http
POST https://app.afipsdk.com/api/v1/automations
Authorization: Bearer <token de AfipSDK>
{
  "automation": "mis-comprobantes",
  "params": {
    "cuit": "30712093486",          // CUIT consultado (la empresa)
    "username": "20xxxxxxxxx",      // CUIT con el que se entra al portal (el administrador de relaciones)
    "password": "clave fiscal",
    "filters": { "t": "R", "fechaEmision": "01/08/2026 - 31/08/2026" }
  }
}
→ { "status": "in_process", "id": "..." }
GET https://app.afipsdk.com/api/v1/automations/:id   (poll cada 5 s)
→ { "status": "complete", "data": [ ...comprobantes... ] }
```

Filtros documentados: `t` (E/R), `fechaEmision` (`dd/mm/yyyy - dd/mm/yyyy`), `puntosVenta`, `tiposComprobantes`, `comprobanteDesde/Hasta`, `tipoDoc`, `nroDoc`, `codigoAutorizacion`. **Son exactamente los parámetros del formulario del portal**: AfipSDK no hace más que entrar con la clave del cliente y ejecutar la misma consulta.

Lo que importa para decidir:

- **Hay que entregarles la Clave Fiscal** en cada request. Es un tercero con la clave de la empresa.
- Precio (afipsdk.com/pricing): plan Free con **10 automatizaciones/mes**; add-on de **1.000 automatizaciones por US$ 50/mes**. Un sync diario de 2 empresas × emitidos + recibidos ≈ 120 automatizaciones/mes, así que el free no alcanza y el costo real es ~US$ 50/mes.
- No documentan cómo lo ejecutan, pero todo indica navegador headless: es lo único posible sin API.
- Conclusión: es un atajo razonable para arrancar rápido, pero no aporta nada que no podamos hacer nosotros, y nos ata a un tercero con la clave.

## 3. Ingeniería inversa del portal (lo relevado hoy)

### 3.1 Login con Clave Fiscal

`https://auth.afip.gob.ar/contribuyente_/login.xhtml` es un formulario **JSF** (verificado descargando la página el 16-sep-2026):

- Paso 1: `<form id="F1" method="post" action="/contribuyente_/login.xhtml;jsessionid=...">` con campos `F1:username` (CUIT), botón `F1:btnSiguiente` y el hidden `javax.faces.ViewState`. Hay que conservar cookies y el `ViewState` entre pasos.
- Paso 2: página `loginClave.xhtml` con `F1:password` y botón `F1:btnIngresar` (según los proyectos que lo automatizan; confirmar con Cowork).
- **No hay CAPTCHA en la página inicial** (no aparecen recaptcha/hcaptcha/turnstile en el HTML). ARCA puede pedir CAPTCHA o segundo factor en situaciones anómalas (IP nueva, intentos fallidos). El **Token de nivel 4** (app "Token ARCA") sólo es obligatorio para operar aduana; una clave nivel 3 entra con usuario y contraseña.
- Al entrar como administrador de relaciones (José) se accede a los servicios de las empresas representadas. El portal maneja el "representado" por CUIT en su API (ver 3.2) y, ya adentro de Mis Comprobantes, hay una pantalla para elegir la persona (ver 3.3).

### 3.2 Portal de Clave Fiscal (SPA)

`https://portalcf.cloud.afip.gob.ar/portal/app/` es una app React. Del bundle `static/js/main.9bed98e0.js` salen los endpoints internos (`/portal/api/` + ruta):

| Endpoint | Qué devuelve |
|---|---|
| `servicios/all` | catálogo de servicios |
| `servicios/{cuit}` | los servicios habilitados para ese CUIT (el representado) |
| `servicios/{cuit}/servicio/{serviceId}/autorizacion` | **`{ token, sign }`** para lanzar el servicio |
| `cuit/{cuit}/status`, `cf/{cuit}/status`, `info` | estado del CUIT / de la clave |

El `serviceId` de Mis Comprobantes es **`mcmp`** (catálogo público `https://www.afip.gob.ar/clavefiscal/app/service-tags.json`: `{"name":"mcmp","tags":"mis comprobantes, ... emitidos, recibidos"}`).

Esta es una pieza que los proyectos existentes no usan y que podría hacer el flujo más robusto: en vez de "buscar y clickear Mis Comprobantes" en la UI, después del login se pide `GET /portal/api/servicios/{CUIT_EMPRESA}/servicio/mcmp/autorizacion` y se lanza el servicio con ese `token`/`sign` (el portal lo hace con un POST auto-enviado a la URL del servicio; **la URL destino y los nombres de los campos del POST son el dato que falta**, punto 5 del brief).

### 3.3 El servicio Mis Comprobantes (MCMP)

- Host actual: **`https://fes.afip.gob.ar/mcmp/`** (hoy responde 403 "Su sesión ha expirado" sin sesión, o sea que existe; `serviciosjava2.afip.gob.ar/mcmp` da 404: ese host histórico ya no sirve).
- Páginas: `/mcmp/jsp/menuPrincipal.do`, `/mcmp/jsp/setearContribuyente.do` (selección de **representado**), `/mcmp/jsp/comprobantesEmitidos.do` y `/mcmp/jsp/comprobantesRecibidos.do`.
- **Representado.** Cuando el que entra administra varias personas, MCMP muestra "Elegí una persona para ingresar / REPRESENTAR A": form `seleccionaEmpresaForm` con `#idcontribuyente`, una tarjeta `a.panel` por persona con el CUIT como `XX-XXXXXXXX-X`. Después se cambia con `[title="Cambiar persona representada"]`, y el CUIT activo se lee de `.nombre-activo`. Esto es lo que resuelve Kawellu vs. Ewwo (además de `cuitConsultada`).
- UI de la consulta: botones `#btnEmitidos` / `#btnRecibidos`, input `#fechaEmision` (jQuery daterangepicker, valor `DD/MM/YYYY - DD/MM/YYYY`), botón `#buscarComprobantes`, tabla `#tablaDataTables`.
- La consulta es **AJAX en dos pasos**, JSON:

```http
GET /mcmp/jsp/ajax.do?f=generarConsulta&t=R&fechaEmision=01%2F08%2F2026%20-%2031%2F08%2F2026&tiposComprobantes=&cuitConsultada=30712093486
X-Requested-With: XMLHttpRequest
→ { "estado": "ok", "datos": { "idConsulta": "…" } }          // "estado" ≠ ok trae "mensajeError"

GET /mcmp/jsp/ajax.do?f=listaResultados&id=<idConsulta>
→ { "estado": "ok", "datos": { "data": [ [col0, col1, …], … ], "consulta": { "cantidadResultados": n } } }

GET /mcmp/jsp/descargarComprobantes.do?id=<idConsulta>&tc=R&tf=csv     // tf=xls también
→ ZIP con el CSV adentro (separador ";", fechas ISO yyyy-mm-dd, decimales con coma)
```

La consulta se procesa en el servidor: la fila de la consulta muestra "Pendiente/Procesando" hasta que está lista, y recién ahí `listaResultados` y `descargarComprobantes.do` devuelven datos (hay que esperar unos segundos y reintentar). **La descarga del ZIP es el camino más limpio para nosotros**: trae el CSV completo con encabezados, sin depender de índices posicionales.

- `t=E` emitidos, `t=R` recibidos. `fechaEmision` con el formato exacto `dd/mm/yyyy - dd/mm/yyyy` (espacios alrededor del guión). `tiposComprobantes[]` opcional. `cuitConsultada` = CUIT de la empresa (esto sirve para representados).
- Cada fila es un **array posicional**. Índices confirmados por dos implementaciones independientes (recibidos):

| Índice | Campo |
|---|---|
| 0 | Fecha de emisión (`yyyymmdd` o `yyyy-mm-dd`) |
| 1 | Tipo de comprobante (código numérico ARCA: 1, 6, 11, 3…) |
| 3 | Punto de venta |
| 4 / 5 | Número desde / hasta |
| 8 | Cód. autorización (CAE/CAEA/CAI) |
| 10 / 11 / 12 | Tipo doc, Nro doc y Denominación del **emisor** (en emitidos: del **receptor**) |
| 13 / 14 | Tipo de cambio / Moneda (`PES`, `DOL`) |
| 15 | Imp. neto gravado |
| 17 | Imp. neto no gravado |
| 19 | Imp. op. exentas |
| 21 | IVA |
| 23 | Imp. total |

Los índices 2, 6, 7, 9, 16, 18, 20, 22 no están documentados (probablemente descripciones legibles, "Otros tributos", percepciones). Se completan con la captura de Cowork.

- **Límites conocidos**: hasta **365 días** por consulta; por arriba de **500 comprobantes** la UI sólo ofera CSV (Excel/PDF desaparecen), el AJAX no sabemos si pagina. Los proyectos existentes consultan en tramos de 30 días para no toparse con esto. Un comprobante puede tardar **hasta 24 h** en aparecer, por eso el sync diario debe re-consultar una ventana solapada (últimos 7 días).
- **CSV exportado** (el mismo que baja el botón CSV o `descargarComprobantes.do`): separador `;`, valores entre comillas, `Fecha de Emisión` en `yyyy-mm-dd`, `Tipo de Comprobante` como código numérico, decimales con coma. Según un scraper de 2026, **emitidos trae 28 columnas y recibidos 30**: fecha, tipo, punto de venta, número desde/hasta, cód. autorización, tipo/nro/denominación del receptor (emitidos) o del emisor **y** del receptor (recibidos), tipo de cambio, moneda, **once columnas de IVA por alícuota**, neto gravado total, neto no gravado, exentas, otros tributos, total IVA, importe total. Los nombres exactos de encabezado (`Imp. Neto Gravado Total`, `Total IVA`, etc.) se confirman con el CSV que capture Cowork. El nombre del archivo incluye `MCE`/`MCR` y el CUIT.

### 3.4 Proyectos de referencia (código público)

| Proyecto | Qué aporta |
|---|---|
| `javiergradiche/fisco-ar-claude-plugin` (Node 20 + **Playwright**, último commit 4-sep-2026) | **El más completo y reciente.** `scripts/lib/arca-login.js` + `scripts/lib/mis-comprobantes.js`: login en dos pasos seteando los inputs por `evaluate` + eventos `input`/`change` (un `fill()` común no dispara los listeners de JSF), abre el servicio desde el portal ("Ver todos" si no está entre los más usados), soporta **apoderado** (`ARCA_<cuit_consultado>_LOGIN` / `_PASSWORD`), setea el daterangepicker, clickea `#buscarComprobantes`, captura `idConsulta` de la respuesta AJAX, espera que la consulta deje de estar Pendiente/Procesando y baja el ZIP por `descargarComprobantes.do?id=&tc=&tf=csv`. Detecta "captcha" y "clave incorrecta". Es el molde natural para nuestro spike. |
| `Francoooo22/arca-scraper` (Python + Playwright + Flask, jul-2026) | Selección de **persona representada** e iteración de varias empresas en una sesión (`setearContribuyente.do`, `a.panel` con CUIT con guiones, `#idcontribuyente`, `[title="Cambiar persona representada"]`); lee la DataTable y captura la URL de `descargarComprobantes.do`. Documenta el layout de 28/30 columnas del CSV. |
| `abrizuela/hack_mis_comprobantes` (extensión Firefox, 2024) | Llama directo a `ajax.do` (`generarConsulta` + `listaResultados`) desde la sesión ya abierta y consulta por año para saltear el límite de la UI. Índices usados por fila: `[0,1,3,4,5,8,10,11,12,13,14,15,17,19,21,23]`. Lee el CUIT activo de `.nombre-activo`. |
| `diego-dotcom/bot_descarga_multiperiodo` (Python + Selenium, abr-2025, GPL) | El "clásico" de estudios contables: lee un Excel de contribuyentes (CUIT, clave, representado, desde, hasta) y baja XLSX/CSV por mes. Selectores: `buscadorInput` → `.search-item`, `//h2[contains(text(), '<representado>')]`, `#btnEmitidos`, `#fechaEmision`, botón "Aplicar", `#buscarComprobantes`, botones Excel/CSV. Anti-bot: `--disable-blink-features=AutomationControlled`. Nota del README: no resuelve cuando ARCA fuerza **cambio de clave**. |
| Gist `alejoasotelo/99e0bdf16db64b783fc42d66321c2946` (jul-2022) | El primero en documentar `ajax.do?f=generarConsulta` + `f=listaResultados`. Corre en la consola del navegador ya logueado. Mapea fecha/tipo/ptoVta/nro/receptor/total. |
| `santyarena1/STOCKRAPIDO` PR #49 "Sync online ARCA propio (sin Afip SDK)" (merged 11-sep-2026) | `apps/api/src/fiscal/arca-portal-client.ts`: **puppeteer-core + @sparticuz/chromium** en Vercel (120 s, 1 GB). Login por selectores `F1:username`/`F1:password` + click por texto "Siguiente"/"Ingresar"; abre Mis Comprobantes buscándolo en la UI del portal (frágil); resuelve el host de `ajax.do` según la URL donde cayó; consulta en tramos de 30 días; dedup por CAE+ptoVta+nro+CUIT. Aborta si detecta "captcha" o "doble factor". Guardan la clave fiscal cifrada en su base. Reemplazaron AfipSDK por costo/límite de automatizaciones. |
| `santyarena1/STOCKRAPIDO` `sync-runner/arca_recibidos_sync_runner.py` | Misma lógica en **Python + Playwright para correr en la PC del usuario** (modo `--headed` para resolver CAPTCHA/2FA a mano). Genera el CSV con los 17 encabezados de arriba y lo sube a su API. Buen molde para el spike. |
| AfipSDK (`github.com/afipsdk`) | Los SDKs sólo llaman a `app.afipsdk.com`; la automatización corre en su backend cerrado. No hay código del scraping. |

Otros con menos valor: `Yoryoboy/ArcaMCP` (MCP que sólo llama a AfipSDK), `nanosgr/arca_scraper` (mismo login, pero baja el Libro IVA), varios bots de Selenium/UiPath con el mismo flujo, y `reingart/pyafipws` **no tiene nada** de Mis Comprobantes (su grupo confirma: "no hay WS, la única solución es automatizar la descarga").

Ninguno usa el endpoint `…/servicio/mcmp/autorizacion` del portal: todos abren el servicio clickeando en la UI y resuelven el representado en la pantalla de MCMP. Para nosotros (José administra Kawellu y Ewwo) el camino probado es ese: entrar, elegir la persona en `setearContribuyente.do` y consultar; la autorización por API queda como optimización a validar en el relevamiento. Modos de falla que sí hay que contemplar: `F1:msg` "Clave o usuario incorrecto" y la pantalla de **cambio de clave fiscal forzado** ("CAMBIAR CLAVE FISCAL").

## 4. Riesgos y decisiones

1. **Clave Fiscal en PNL.** Para automatizar hay que guardar usuario y clave. Propuesta: cifrado AES-256-GCM con una clave sólo en el `.env` de la VM, alta/baja desde Configuración con rol ADMINISTRADOR, nunca en logs ni en auditoría, y un usuario de Clave Fiscal **dedicado** (ARCA permite "Administrador de Relaciones" delegar el servicio Mis Comprobantes a otra persona/CUIT): así la clave guardada no es la de José y se puede revocar sin tocar nada más.
2. **CAPTCHA / segundo factor.** Puede aparecer por IP nueva o cambios de ARCA. Mitigación: correr desde la VM de la oficina (IP fija, no datacenter), un solo login por día, sesión reutilizada, y un **fallback manual**: importar el CSV que se baja del portal. Si ARCA obliga 2FA a futuro, queda el CSV.
3. **Fragilidad del portal.** Cambios de host (ya pasó: serviciosjava2 → fes), de índices de columnas o del login. Mitigación: la consulta va por AJAX (menos frágil que la UI), tests con JSON de muestra, alerta al fallar el sync y el fallback CSV.
4. **Términos de uso.** No hay API oficial ni prohibición explícita; es la propia empresa consultando sus datos con su clave, a ritmo de una persona (2 consultas/día/empresa). No usar proxies ni paralelismo.
5. **Build vs. comprar.** AfipSDK cuesta ~US$ 50/mes y exige entregarles la clave; lo propio son ~2 semanas de trabajo repartidas en fases y control total. Recomendación: **propio**, con el importador CSV primero (sirve igual aunque el scraping no ande).

## 5. Plan propuesto para PNL

**F0 · Relevamiento con Cowork (1 sesión, sin código).** Capturar en el navegador real las requests exactas (brief en la sección 6). Salida: JSON de muestra de emitidos y recibidos con encabezados, request de lanzamiento del servicio, CSV de muestra.

**F1 · Modelo + importador CSV + vista de faltantes.** Tabla `ComprobanteArca` (empresa, origen E/R, fecha, tipo, ptoVta, nro, CAE, cuit y denominación de contraparte, moneda, TC, netos, IVA, otros tributos, total, `fuente` csv/portal, `sincronizadoAt`; único por empresa+origen+cuitContraparte+tipo+ptoVta+nro). Pantalla "ARCA" con: subir CSV de Mis Comprobantes, cruce contra `Movimiento` por (CUIT, tipo, ptoVta, nro) y por CAE, lista de **faltantes** (en ARCA y no en el libro) y **no figura** (en el libro y no en ARCA), y acción "cargar a mano desde el faltante". Valor inmediato aunque no haya scraping.

**F2 · Spike de scraping (script, fuera del pipeline).** `scripts/arca-mis-comprobantes.ts` con Playwright, tomando como referencia `fisco-ar-claude-plugin`: login en dos pasos (inputs por `evaluate` + eventos) → abrir Mis Comprobantes desde el portal → elegir el representado → `generarConsulta` por AJAX (tramos de 30 días) → esperar "Procesando" → bajar el ZIP con `descargarComprobantes.do?tf=csv` → parsear el CSV con encabezados. Probado a mano contra Ewwo en modo headed y luego headless en la VM (chromium + deps apt).

**F3 · Sync automático.** Credenciales cifradas por empresa; job `SYNC_MIS_COMPROBANTES` en `pnl-worker` a la madrugada, ventana [hoy−7, hoy] para emitidos y recibidos, upsert en `ComprobanteArca`, auditoría del resultado, alerta en la pantalla ARCA si falla (con el botón de importar CSV como plan B).

**F4 · Reemplazar la constatación.** `arcaEstado` pasa a resolverse contra `ComprobanteArca`: match exacto → `VALIDO` (fuente "Mis Comprobantes"), sin match después de N días → `NO_FIGURA` y se observa el movimiento, igual que hoy con `INVALIDO`. El modo `ws` (certificado) queda como opción futura, no como camino.

## 6. Brief para Claude Cowork (relevamiento en el navegador de José)

Objetivo: capturar, con las DevTools del navegador (pestaña Network, "Preserve log"), las requests reales del portal para "Mis Comprobantes" de **Ewwo Consulting** (CUIT 30712093486), entrando con la Clave Fiscal de José. Todo lo que se entregue tiene que estar **sin cookies, sin `token`/`sign` completos y sin la clave**: reemplazarlos por `***`.

Pasos y qué guardar de cada uno:

1. **Login.** Ir a `https://auth.afip.gob.ar/contribuyente_/login.xhtml`, poner el CUIT y "Siguiente"; poner la clave e "Ingresar". Guardar: la URL y el `Form Data` de los **dos POST** (nombres de todos los campos; valores tapados) y a qué URL redirige al final. Anotar si apareció CAPTCHA, código por mail/SMS o pantalla de "token".
2. **Portal.** En `https://portalcf.cloud.afip.gob.ar/portal/app/`, filtrar Network por `portal/api`. Guardar la lista de requests con método, URL completa y el JSON de respuesta de: `servicios/{cuit}` (o `servicios/all`) y cualquier request que mencione `mcmp`. Anotar si hay que elegir el "representado" (Ewwo) en la UI y qué request dispara eso.
3. **Lanzar Mis Comprobantes.** Buscar "Mis Comprobantes" y abrirlo (se abre en una pestaña nueva; las DevTools hay que abrirlas ahí también). Guardar: el request `…/servicio/mcmp/autorizacion` (URL exacta y forma del JSON de respuesta, valores tapados) y el **request siguiente que sale del portal hacia el servicio**: método, URL destino (esperamos `https://fes.afip.gob.ar/mcmp/...`), nombres de los campos del formulario (esperamos `token` y `sign`) y las redirecciones hasta la URL final. Si aparece "Elegí una persona para ingresar", elegir Ewwo y guardar el POST que dispara (esperamos `setearContribuyente.do` con `idcontribuyente`) y una captura de esa pantalla con las personas listadas.
4. **Emitidos.** En Mis Comprobantes → Comprobantes Emitidos, consultar el rango 01/08/2026 a 31/08/2026 sin otros filtros. Guardar: la request `ajax.do?f=generarConsulta…` completa (todos los parámetros de la query) y su respuesta; la request `ajax.do?f=listaResultados…` y su **respuesta JSON completa** (Copy → Response). Además, en la tabla en pantalla, copiar los **encabezados de columna en orden** (o el HTML de `<thead>`), para mapear los índices del array.
5. **Recibidos.** Repetir el paso 4 en Comprobantes Recibidos, mismo rango.
6. **Exportar.** Con el resultado de Recibidos en pantalla, tocar CSV, Excel y PDF. Guardar la request de cada botón (esperamos `descargarComprobantes.do?id=…&tc=R&tf=csv`) y **el archivo que baja** (es un ZIP con el CSV adentro; guardar el ZIP tal cual, con su nombre). Repetir el CSV para Emitidos. Si el rango 01/01/2026–31/08/2026 supera 500 filas, probarlo y anotar qué botones desaparecen y si `listaResultados` trae todas las filas o pagina (`length`, `start`, `draw` en la query).
7. **Otros filtros.** Abrir el selector de tipos de comprobante y de punto de venta: copiar las opciones (código y texto) y qué parámetro agregan a `generarConsulta` (`tiposComprobantes[]`, `puntosVenta[]`).
8. **Sesión.** Anotar la duración: dejar la pestaña abierta 30 minutos y repetir una consulta; ver si pide login de nuevo. Guardar los nombres (no los valores) de las cookies de `fes.afip.gob.ar` y `auth.afip.gob.ar`.

Entregables: un `.md` con las URLs, parámetros y observaciones por paso; los JSON de `listaResultados` (emitidos y recibidos) y el CSV, todos con CUITs de terceros intactos (son datos de la empresa) pero sin credenciales; capturas de pantalla de la tabla, del selector de tipos y de cualquier pantalla inesperada (CAPTCHA, 2FA, representado).

## 7. Fuentes

- afipsdk.com/blog/descargar-mis-comprobantes-de-arca-via-api/ · afipsdk.com/pricing/ · afipsdk.com/docs/automations/introduction/
- gist.github.com/alejoasotelo/99e0bdf16db64b783fc42d66321c2946
- github.com/santyarena1/STOCKRAPIDO/pull/49 (arca-portal-client.ts, sync-runner/arca_recibidos_sync_runner.py)
- github.com/javiergradiche/fisco-ar-claude-plugin · github.com/Francoooo22/arca-scraper · github.com/abrizuela/hack_mis_comprobantes · github.com/diego-dotcom/bot_descarga_multiperiodo
- github.com/AfipSDK/afip.js (CreateAutomation: sólo cliente HTTP de app.afipsdk.com) · groups.google.com/g/pyafipws/c/V4qV5P1Dqwo
- portalcf.cloud.afip.gob.ar/portal/app/static/js/main.9bed98e0.js (endpoints `/portal/api/...`) · afip.gob.ar/clavefiscal/app/service-tags.json (`mcmp`)
- contadoresenred.com (límite 365 días, >500 filas sólo CSV) · afip.gob.ar/clavefiscal/ayuda/token.asp (nivel 4)
