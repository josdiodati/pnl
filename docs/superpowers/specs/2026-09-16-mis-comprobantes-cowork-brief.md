# Prompt para Claude Cowork — relevamiento de "Mis Comprobantes" en el portal de ARCA (Ewwo)

Copiar desde la línea siguiente hasta el final y pegarlo en Cowork tal cual.

---

Necesito que me ayudes a relevar, con las DevTools del navegador, cómo funciona por dentro el servicio **"Mis Comprobantes"** del portal de ARCA (ex AFIP), para después automatizar la descarga diaria de comprobantes emitidos y recibidos en una app interna. Yo voy a entrar con mi Clave Fiscal; vos me guiás paso a paso, me decís qué mirar y qué copiar, y al final armás el informe. Todo se hace con la empresa **Ewwo Consulting S.R.L., CUIT 30-71209348-6**.

**Reglas de seguridad, no negociables:**
- Nunca me pidas ni anotes la Clave Fiscal. Cualquier valor de `password`, cookie, `token`, `sign` o `JSESSIONID` que aparezca en una request se reemplaza por `***` en el informe.
- No pruebes claves incorrectas ni reintentes un login que falló: ARCA bloquea la clave después de varios intentos fallidos.
- Los CUITs y razones sociales de terceros que aparezcan en los listados sí se conservan: son datos de la empresa y los necesito para probar.

**Preparación:** abrir Chrome o Edge, abrir DevTools (F12) → pestaña **Network**, activar **"Preserve log"** y **"Disable cache"**. Cada vez que se abra una pestaña nueva del portal, abrir DevTools también en esa pestaña.

**Paso 1 — Login.** Ir a `https://auth.afip.gob.ar/contribuyente_/login.xhtml`. Poner el CUIT y "Siguiente"; poner la clave e "Ingresar". Copiar de Network, para cada uno de los **dos POST** del formulario: la URL exacta (incluido `;jsessionid=…` si aparece), y en "Payload" la lista completa de nombres de campos (tapando los valores de la clave y del ViewState). Anotar a qué URL termina redirigiendo. Anotar si aparece CAPTCHA, un código por mail o SMS, la app Token, o una pantalla de cambio de clave.

**Paso 2 — Portal de Clave Fiscal.** Ya en `https://portalcf.cloud.afip.gob.ar/portal/app/`, filtrar Network por `portal/api`. Copiar método, URL completa y el JSON de respuesta (Preview → Copy) de: `servicios/{cuit}` o `servicios/all`, `info`, y cualquier request cuya URL o respuesta mencione `mcmp`. Anotar si en el portal hay que elegir el representado (Ewwo) antes de ver los servicios, y qué request dispara eso.

**Paso 3 — Abrir Mis Comprobantes.** Buscar "Mis Comprobantes" (si no está entre los más usados, "Ver todos") y abrirlo. Se abre en una pestaña nueva: abrir DevTools ahí. Copiar:
- El request a `…/portal/api/servicios/{cuit}/servicio/mcmp/autorizacion` (o similar): URL exacta y la forma del JSON de respuesta con los valores tapados.
- El **primer request que sale del portal hacia el servicio**: método, URL destino (esperamos algo bajo `https://fes.afip.gob.ar/mcmp/…`), nombres de los campos del formulario o parámetros (esperamos `token` y `sign`), y la cadena de redirecciones hasta la URL final de la página.
- Si aparece **"Elegí una persona para ingresar"** o "REPRESENTAR A", una captura de pantalla de esa vista con las personas listadas, y después de elegir Ewwo, el request que disparó (esperamos `setearContribuyente.do`) con sus parámetros.
- La URL final de la página del menú y el texto que muestra como persona activa.

**Paso 4 — Comprobantes emitidos.** Entrar a "Comprobantes Emitidos". Poner el rango **01/08/2026 a 31/08/2026**, sin otros filtros, y "Buscar". Copiar:
- La request `ajax.do?f=generarConsulta…` completa (URL con todos los parámetros de la query) y su respuesta JSON.
- Todas las requests `ajax.do?…` que vengan después (esperamos `listaResultados`) con la URL completa y la **respuesta JSON entera** (Copy → Response, guardarla en un archivo `emitidos-2026-08.json`).
- De la tabla en pantalla: los **encabezados de columna en orden**. Lo más simple: en la pestaña Elements, click derecho sobre el `<thead>` de la tabla → Copy → Copy outerHTML.
- Anotar cuánto tardó en aparecer el resultado y si mostró un estado tipo "Pendiente" o "Procesando" antes.

**Paso 5 — Comprobantes recibidos.** Repetir el paso 4 en "Comprobantes Recibidos", mismo rango. Guardar la respuesta como `recibidos-2026-08.json`.

**Paso 6 — Exportar.** Con el resultado de Recibidos en pantalla, tocar los botones **CSV**, **Excel** y **PDF**, uno por uno. Para cada uno copiar la request que dispara (esperamos `descargarComprobantes.do?id=…&tc=R&tf=…`) y guardar el archivo que baja **tal cual, sin renombrar ni descomprimir** (esperamos un ZIP con el CSV adentro). Repetir sólo el CSV para Emitidos.

**Paso 7 — Volumen grande.** En Recibidos, consultar **01/01/2026 a 31/08/2026**. Anotar cuántos resultados informa la tabla, si desaparecen botones de exportación, y si la request `listaResultados` trae todo de una o pagina (mirar si aparecen parámetros como `start`, `length`, `draw`, o si hay varias requests seguidas). Si trae todo, guardar la respuesta como `recibidos-2026-ene-ago.json`.

**Paso 8 — Filtros.** Abrir el selector de "Tipo de comprobante" y el de "Punto de venta": copiar las opciones (código y texto). Elegir un tipo cualquiera, buscar, y copiar la request `generarConsulta` para ver cómo viajan (esperamos `tiposComprobantes[]=…`).

**Paso 9 — Sesión y salida.** Dejar la pestaña abierta 30 minutos y repetir una consulta: anotar si sigue funcionando o pide login. En Application → Cookies, copiar los **nombres** (no los valores) de las cookies de `fes.afip.gob.ar`, `portalcf.cloud.afip.gob.ar` y `auth.afip.gob.ar`. Cerrar sesión con el botón "Salir" del servicio y copiar la request que dispara.

**Entregables (en una carpeta):**
1. `informe.md` con, por paso, las URLs, parámetros, nombres de campos, redirecciones y observaciones. Cerrar con una sección "Sorpresas" para todo lo que no coincidió con lo esperado.
2. `emitidos-2026-08.json`, `recibidos-2026-08.json` y, si aplica, `recibidos-2026-ene-ago.json`.
3. `thead-emitidos.html` y `thead-recibidos.html` con los encabezados de la tabla.
4. Los archivos exportados sin modificar (ZIP/CSV/XLS/PDF).
5. Capturas de pantalla: pantalla de representados, tabla de resultados, selector de tipos, y cualquier pantalla inesperada (CAPTCHA, código de verificación, cambio de clave).

Antes de entregar, revisá que en ningún archivo quede la clave, un `token`, un `sign` ni un valor de cookie.
