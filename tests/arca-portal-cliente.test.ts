import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  ClientePortalArca,
  ErrorLoginArca,
  ErrorSesionVencida,
  ErrorPortalArca,
  descargarMisComprobantes,
  type Transporte,
  type PedidoHttp,
  type RespuestaHttp,
} from '@/lib/arca/portal/cliente';

// Cliente HTTP del portal de ARCA (sin navegador), contra un transporte falso
// que reproduce la secuencia relevada el 16-sep-2026: login JSF en dos POST,
// ticket del portal, handshake token/sign a index.do, representado por índice,
// consulta en tres pasos y descarga del ZIP.

const CUIT_USUARIO = '20314194080';
const CUIT_EMPRESA = '30712093486';

const LOGIN_HTML = `<form id="F1" name="F1" method="post" action="/contribuyente_/login.xhtml;jsessionid=J1.auth10"><input name="F1:username"/><input name="F1:btnSiguiente"/><input type="hidden" name="javax.faces.ViewState" value="VS1"/></form>`;
const CLAVE_HTML = `<form id="F1" name="F1" method="post" action="/contribuyente_/loginClave.xhtml"><input type="hidden" name="F1:captcha" value=""/><input name="F1:username" type="text"/><input name="F1:password" type="password"/><input name="F1:btnIngresar"/><input type="hidden" name="javax.faces.ViewState" value="VS2"/></form>`;
const INDEX_HTML = `<div class="panel panel-border">DIODATI [20-31419408-0]</div>
<a class="panel panel-default hoverazul" onclick="document.getElementById('idcontribuyente').value='0';document.seleccionaEmpresaForm.submit();return false;">ARBOLITO ROJO S.R.L. 30-71777827-4</a>
<a class="panel panel-default hoverazul" onclick="document.getElementById('idcontribuyente').value='2';document.seleccionaEmpresaForm.submit();return false;">EWWO CONSULTING S.R.L. 30-71209348-6</a>`;
const MENU_HTML = `<div>DIODATI JOSE [20-31419408-0]</div><div>REPRESENTANDO A: EWWO CONSULTING S.R.L. [30-71209348-6]</div>`;
const CSV_RECIBIDOS =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"\n' +
  '2026-08-01;1;1007;4312246;4312246;86294874222078;80;30656631615;ALARMAS EJEMPLO S.A.;80;30712093486;1,00;$;;;;;;;;19305,30;91929,98;;;91929,98;0,00;0,00;2757,90;19305,30;113993,18\n';

function zip(nombre: string, contenido: string): Buffer {
  const datos = deflateRawSync(Buffer.from(contenido, 'utf8'));
  const nb = Buffer.from(nombre);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(datos.length, 18); local.writeUInt32LE(Buffer.byteLength(contenido), 22); local.writeUInt16LE(nb.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(datos.length, 20); central.writeUInt32LE(Buffer.byteLength(contenido), 24); central.writeUInt16LE(nb.length, 28); central.writeUInt32LE(0, 42);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + nb.length, 12); fin.writeUInt32LE(30 + nb.length + datos.length, 16);
  return Buffer.concat([local, nb, datos, central, nb, fin]);
}

type RespuestaFalsa = Omit<Partial<RespuestaHttp>, 'body'> & { body?: string | Buffer };
type Regla = { test: (p: PedidoHttp) => boolean; responder: (p: PedidoHttp) => RespuestaFalsa };

/** Transporte falso: cada request se resuelve contra la primera regla que matchea; registra todo. */
function transporteFalso(reglas: Regla[]) {
  const pedidos: PedidoHttp[] = [];
  const transporte: Transporte = async (p) => {
    pedidos.push(p);
    const regla = reglas.find((r) => r.test(p));
    if (!regla) throw new Error(`sin regla para ${p.method} ${p.url}`);
    const r = regla.responder(p);
    return {
      status: r.status ?? 200,
      headers: { 'content-type': 'text/html', ...(r.headers ?? {}) },
      setCookies: r.setCookies ?? [],
      body: typeof r.body === 'string' ? Buffer.from(r.body, 'utf8') : (r.body ?? Buffer.alloc(0)),
    };
  };
  return { transporte, pedidos };
}

const es = (method: string, frag: string) => (p: PedidoHttp) => p.method === method && p.url.includes(frag);

function reglasFelices(opts: { csvRespuestas?: () => RespuestaFalsa; listaRespuesta?: () => string } = {}): Regla[] {
  return [
    { test: es('GET', 'auth.afip.gob.ar/contribuyente_/login.xhtml'), responder: () => ({ body: LOGIN_HTML, setCookies: ['JSESSIONID=J1.auth10; Path=/contribuyente_; HttpOnly'] }) },
    { test: es('POST', 'login.xhtml;jsessionid=J1.auth10'), responder: () => ({ body: CLAVE_HTML }) },
    { test: es('POST', 'loginClave.xhtml'), responder: () => ({ status: 302, headers: { location: 'https://portalcf.cloud.afip.gob.ar/portal/app/' }, setCookies: ['TS01bd882d=abc; Domain=.afip.gob.ar; Path=/'] }) },
    { test: es('GET', 'portalcf.cloud.afip.gob.ar/portal/app/'), responder: () => ({ body: '<html>portal</html>' }) },
    { test: es('GET', '/portal/api/info'), responder: () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cuit: 20314194080, representados: [20314194080], authMethod: 'passphrase' }) }) },
    { test: es('GET', `/portal/api/servicios/${CUIT_USUARIO}/servicio/mcmp/autorizacion`), responder: () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sign: 'S1', token: 'T1' }) }) },
    { test: es('POST', 'fes.afip.gob.ar/mcmp/jsp/index.do'), responder: () => ({ body: INDEX_HTML, setCookies: ['SESSION_TOKEN=st; Path=/mcmp', 'SESSION_SIGN=ss; Path=/mcmp'] }) },
    { test: es('GET', 'setearContribuyente.do?idContribuyente=2'), responder: () => ({ body: MENU_HTML }) },
    { test: es('GET', 'ajax.do?f=generarConsulta'), responder: () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'ok', datos: { idConsulta: '212553003', estado: 'PE' } }) }) },
    { test: es('GET', 'ajax.do?f=estimarResultados&id=212553003'), responder: () => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'ok', datos: { serverSide: false } }) }) },
    { test: es('GET', 'ajax.do?f=listaResultados&id=212553003'), responder: () => ({ headers: { 'content-type': 'application/json' }, body: opts.listaRespuesta?.() ?? JSON.stringify({ estado: 'ok', recordsTotal: 1, datos: { consulta: { cantidadResultados: 1, estado: 'PR' }, data: [[]] } }) }) },
    { test: es('GET', 'descargarComprobantes.do?id=212553003&tc=R&tf=csv'), responder: () => opts.csvRespuestas?.() ?? ({ headers: { 'content-type': 'application/zip' }, body: zip('recibidos.csv', CSV_RECIBIDOS) }) },
    { test: es('GET', 'logout.do'), responder: () => ({ status: 404, body: 'not found' }) },
  ];
}

describe('ClientePortalArca: flujo feliz', () => {
  it('loguea, abre Mis Comprobantes para la empresa y baja recibidos en CSV', async () => {
    const { transporte, pedidos } = transporteFalso(reglasFelices());
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await cliente.abrirMisComprobantes(CUIT_EMPRESA);
    const r = await cliente.consultar('RECIBIDO', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'), CUIT_EMPRESA);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].nroDocContraparte).toBe('30656631615');
    expect(r.idConsulta).toBe('212553003');
    await cliente.salir();

    // Login: los dos POST con los campos JSF y el ViewState de cada pantalla.
    const post1 = pedidos.find((p) => p.method === 'POST' && p.url.includes('login.xhtml'))!;
    expect(post1.body).toContain('F1%3Ausername=20314194080');
    expect(post1.body).toContain('javax.faces.ViewState=VS1');
    expect(post1.body).toContain('F1%3AbtnSiguiente=');
    const post2 = pedidos.find((p) => p.method === 'POST' && p.url.includes('loginClave.xhtml'))!;
    expect(post2.body).toContain('F1%3Apassword=clave');
    expect(post2.body).toContain('javax.faces.ViewState=VS2');
    expect(post2.body).toContain('F1%3Acaptcha=');
    // El jsessionid de la URL va en el POST 1 y la cookie vuelve en el 2.
    expect(post2.headers?.cookie).toContain('JSESSIONID=J1.auth10');

    // Handshake: token y sign como form-urlencoded a index.do.
    const handshake = pedidos.find((p) => p.url.endsWith('/mcmp/jsp/index.do'))!;
    expect(handshake.method).toBe('POST');
    expect(handshake.body).toBe('token=T1&sign=S1');
    // Las cookies del servicio viajan a las consultas; las del portal no.
    const consulta = pedidos.find((p) => p.url.includes('f=generarConsulta'))!;
    expect(consulta.headers?.cookie).toContain('SESSION_TOKEN=st');
    expect(consulta.headers?.cookie).not.toContain('JSESSIONID');
    expect(consulta.url).toContain('t=R');
    expect(consulta.url).toContain('fechaEmision=01%2F08%2F2026%20-%2031%2F08%2F2026');
    expect(consulta.url).toContain(`cuitConsultada=${CUIT_EMPRESA}`);
    // Orden obligatorio: generar → estimar → lista → descarga.
    const orden = pedidos.filter((p) => p.url.includes('ajax.do') || p.url.includes('descargarComprobantes')).map((p) => p.url.match(/f=(\w+)|descargar/)![0]);
    expect(orden).toEqual(['f=generarConsulta', 'f=estimarResultados', 'f=listaResultados', 'descargar']);
  });

  it('descargarMisComprobantes hace UN login y consulta emitidos y recibidos por rango', async () => {
    const reglas = reglasFelices();
    reglas.splice(11, 0, { test: es('GET', 'descargarComprobantes.do?id=212553003&tc=E&tf=csv'), responder: () => ({ headers: { 'content-type': 'application/zip' }, body: zip('emitidos.csv', CSV_RECIBIDOS.replace('"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";', '').replace(';80;30656631615;ALARMAS EJEMPLO S.A.;80;30712093486;', ';80;30712093486;EWWO;').replace('"Tipo Doc. Receptor";"Nro. Doc. Receptor";', '"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Denominación Receptor";')) }) });
    const { transporte, pedidos } = transporteFalso(reglas);
    const r = await descargarMisComprobantes(
      { cuitUsuario: CUIT_USUARIO, clave: 'clave', cuitEmpresa: CUIT_EMPRESA, desde: new Date('2026-08-01T00:00:00Z'), hasta: new Date('2026-08-31T00:00:00Z') },
      { transporte, pausaMs: 0 },
    );
    expect(r.recibidos).toHaveLength(1);
    expect(r.emitidos).toHaveLength(1);
    expect(pedidos.filter((p) => p.url.includes('loginClave.xhtml'))).toHaveLength(1);
  });
});

describe('ClientePortalArca: fallos', () => {
  it('clave incorrecta: ErrorLoginArca con motivo credenciales, sin segundo intento', async () => {
    const reglas = reglasFelices();
    reglas[2] = { test: es('POST', 'loginClave.xhtml'), responder: () => ({ body: '<span id="F1:msg">Clave o usuario incorrecto</span>' + CLAVE_HTML }) };
    const { transporte, pedidos } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await expect(cliente.login(CUIT_USUARIO, 'mala')).rejects.toMatchObject({ name: 'ErrorLoginArca', motivo: 'credenciales' });
    expect(pedidos.filter((p) => p.method === 'POST')).toHaveLength(2);
  });

  it('CAPTCHA en el login: ErrorLoginArca con motivo captcha', async () => {
    const reglas = reglasFelices();
    reglas[1] = { test: es('POST', 'login.xhtml;jsessionid=J1.auth10'), responder: () => ({ body: CLAVE_HTML.replace('<input name="F1:password"', '<img src="/captcha.jpg"> Ingresá el código de la imagen <input name="F1:password"') }) };
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await expect(cliente.login(CUIT_USUARIO, 'clave')).rejects.toMatchObject({ motivo: 'captcha' });
  });

  it('login que no llega al portal sin mensaje conocido: ErrorLoginArca desconocido (tampoco se reintenta)', async () => {
    const reglas = reglasFelices();
    reglas[4] = { test: es('GET', '/portal/api/info'), responder: () => ({ body: '<html>login</html>' }) };
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await expect(cliente.login(CUIT_USUARIO, 'clave')).rejects.toMatchObject({ name: 'ErrorLoginArca', motivo: 'desconocido' });
  });

  it('la empresa no está entre los representados: ErrorPortalArca', async () => {
    const { transporte } = transporteFalso(reglasFelices());
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await expect(cliente.abrirMisComprobantes('30718332148')).rejects.toBeInstanceOf(ErrorPortalArca);
  });

  it('la cabecera no dice REPRESENTANDO A la empresa: aborta antes de consultar', async () => {
    const reglas = reglasFelices();
    reglas[7] = { test: es('GET', 'setearContribuyente.do'), responder: () => ({ body: 'REPRESENTANDO A: ARBOLITO ROJO S.R.L. [30-71777827-4]' }) };
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await expect(cliente.abrirMisComprobantes(CUIT_EMPRESA)).rejects.toThrow(/REPRESENTANDO/);
  });

  it('sesión vencida en medio de la consulta: ErrorSesionVencida', async () => {
    const reglas = reglasFelices();
    reglas[8] = { test: es('GET', 'ajax.do?f=generarConsulta'), responder: () => ({ body: '<html>No se encuentra logueado al sistema o su sesión expiró</html>' }) };
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await cliente.abrirMisComprobantes(CUIT_EMPRESA);
    await expect(cliente.consultar('RECIBIDO', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'), CUIT_EMPRESA)).rejects.toBeInstanceOf(ErrorSesionVencida);
  });

  it('el WAF bloquea una vez: se reintenta con espera y sale bien', async () => {
    let veces = 0;
    const reglas = reglasFelices({
      csvRespuestas: () => (veces++ === 0 ? { status: 503, body: '' } : { headers: { 'content-type': 'application/zip' }, body: zip('r.csv', CSV_RECIBIDOS) }),
    });
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await cliente.abrirMisComprobantes(CUIT_EMPRESA);
    const r = await cliente.consultar('RECIBIDO', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'), CUIT_EMPRESA);
    expect(r.filas).toHaveLength(1);
    expect(veces).toBe(2);
  });

  it('descarga que no es ZIP (WAF con 200 y 55 bytes): ErrorPortalArca tras agotar reintentos', async () => {
    const reglas = reglasFelices({ csvRespuestas: () => ({ body: 'BL2144953316145 2026-09-16 11:14:11 2026-09-16 11:14:11' }) });
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await cliente.abrirMisComprobantes(CUIT_EMPRESA);
    await expect(cliente.consultar('RECIBIDO', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'), CUIT_EMPRESA)).rejects.toBeInstanceOf(ErrorPortalArca);
  });

  it('consulta sin resultados: lista vacía, no es error', async () => {
    const reglas = reglasFelices({
      listaRespuesta: () => JSON.stringify({ estado: 'ok', recordsTotal: 0, datos: { consulta: { cantidadResultados: 0, error: null }, data: [] } }),
      csvRespuestas: () => ({ headers: { 'content-type': 'application/zip' }, body: zip('r.csv', CSV_RECIBIDOS.split('\n')[0] + '\n') }),
    });
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    await cliente.abrirMisComprobantes(CUIT_EMPRESA);
    const r = await cliente.consultar('RECIBIDO', new Date('2026-08-02T00:00:00Z'), new Date('2026-08-02T00:00:00Z'), CUIT_EMPRESA);
    expect(r.filas).toEqual([]);
  });

  it('descargarMisComprobantes: si el login falla, no consulta nada y propaga ErrorLoginArca', async () => {
    const reglas = reglasFelices();
    reglas[2] = { test: es('POST', 'loginClave.xhtml'), responder: () => ({ body: 'Clave o usuario incorrecto' }) };
    const { transporte, pedidos } = transporteFalso(reglas);
    await expect(
      descargarMisComprobantes({ cuitUsuario: CUIT_USUARIO, clave: 'x', cuitEmpresa: CUIT_EMPRESA, desde: new Date('2026-08-01T00:00:00Z'), hasta: new Date('2026-08-31T00:00:00Z') }, { transporte, pausaMs: 0 }),
    ).rejects.toBeInstanceOf(ErrorLoginArca);
    expect(pedidos.some((p) => p.url.includes('ajax.do'))).toBe(false);
  });
});

describe('ClientePortalArca: redirección por HTML después del login y traza técnica', () => {
  it('sigue un formulario auto-enviado hacia el portal en vez de dar el login por fallido', async () => {
    const reglas = reglasFelices();
    reglas[2] = {
      test: es('POST', 'loginClave.xhtml'),
      responder: () => ({ body: `<body onload="document.forms[0].submit()"><form method="post" action="https://portalcf.cloud.afip.gob.ar/portal/sso"><input type="hidden" name="token" value="T"/><input type="hidden" name="sign" value="S"/></form></body>` }),
    };
    reglas.push({ test: es('POST', 'portalcf.cloud.afip.gob.ar/portal/sso'), responder: () => ({ status: 302, headers: { location: '/portal/app/' }, setCookies: ['PORTALSESSION=p1; Path=/'] }) });
    const { transporte, pedidos } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    await cliente.login(CUIT_USUARIO, 'clave');
    const sso = pedidos.find((p) => p.url.includes('/portal/sso'))!;
    expect(sso.method).toBe('POST');
    expect(sso.body).toBe('token=T&sign=S');
    const info = pedidos.find((p) => p.url.includes('/portal/api/info'))!;
    expect(info.headers?.cookie).toContain('PORTALSESSION=p1');
  });

  it('login desconocido: el error trae la traza de pasos, sin clave ni ViewState', async () => {
    const reglas = reglasFelices();
    reglas[4] = { test: es('GET', '/portal/api/info'), responder: () => ({ body: '<html><title>Portal</title>login requerido</html>' }) };
    const { transporte } = transporteFalso(reglas);
    const cliente = new ClientePortalArca({ transporte, pausaMs: 0 });
    let error: ErrorLoginArca | null = null;
    try {
      await cliente.login(CUIT_USUARIO, 'clave-secreta');
    } catch (e) {
      error = e as ErrorLoginArca;
    }
    expect(error?.motivo).toBe('desconocido');
    const traza = error!.traza!;
    expect(traza.length).toBeGreaterThanOrEqual(5);
    expect(traza.some((t) => t.url.includes('/portal/api/info') && t.resumen.includes('login requerido'))).toBe(true);
    const texto = JSON.stringify(traza);
    expect(texto).not.toContain('clave-secreta');
    expect(texto).not.toContain('VS1');
    expect(texto).not.toContain('VS2');
    expect(texto).not.toContain('J1.auth10'); // jsessionid tampoco
  });
});
