import { describe, it, expect } from 'vitest';
import {
  extraerViewState,
  extraerAccionFormulario,
  indiceRepresentado,
  verificarRepresentando,
  clasificarRespuestaAjax,
  detectarFalloLogin,
  rangoFechasPortal,
} from '@/lib/arca/portal/parsing';

// Piezas puras del cliente del portal de ARCA (Clave Fiscal + Mis
// Comprobantes), según el relevamiento del 16-sep-2026.

const LOGIN_HTML = `<html><body>
<form id="F1" name="F1" method="post" action="/contribuyente_/login.xhtml;jsessionid=ABC123.auth10" enctype="application/x-www-form-urlencoded">
<input type="hidden" name="F1" value="F1" />
<input id="F1:username" type="number" name="F1:username" />
<input id="F1:btnSiguiente" type="submit" name="F1:btnSiguiente" value="Siguiente" />
<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="-1234567890:987654321" autocomplete="off" />
</form></body></html>`;

const INDEX_HTML = `<html><body>
<div class="panel panel-border"><h4>DIODATI JOSE [20-31419408-0]</h4></div>
<h3>Elegí una persona para ingresar</h3>
<form name="seleccionaEmpresaForm" method="GET" action="setearContribuyente.do"><input type="hidden" id="idcontribuyente" name="idContribuyente"/></form>
<a class="panel panel-default hoverazul" onclick="document.getElementById('idcontribuyente').value='0';document.seleccionaEmpresaForm.submit();return false;">ARBOLITO ROJO S.R.L. 30-71777827-4</a>
<a class="panel panel-default hoverazul" onclick="document.getElementById('idcontribuyente').value='1';document.seleccionaEmpresaForm.submit();return false;">DIODATI JOSE 20-31419408-0</a>
<a class="panel panel-default hoverazul" onclick="document.getElementById('idcontribuyente').value='2';
   document.seleccionaEmpresaForm.submit();return false;">
   EWWO CONSULTING S.R.L.  30-71209348-6
</a>
</body></html>`;

describe('login JSF', () => {
  it('extrae el ViewState y el action con jsessionid', () => {
    expect(extraerViewState(LOGIN_HTML)).toBe('-1234567890:987654321');
    expect(extraerAccionFormulario(LOGIN_HTML)).toBe('/contribuyente_/login.xhtml;jsessionid=ABC123.auth10');
  });
  it('sin ViewState falla explícitamente', () => {
    expect(() => extraerViewState('<html></html>')).toThrow(/ViewState/);
  });
  it('detecta los fallos de login que NO deben reintentarse', () => {
    expect(detectarFalloLogin('<span id="F1:msg">Clave o usuario incorrecto</span>')).toBe('credenciales');
    expect(detectarFalloLogin('<h4>CAMBIAR CLAVE FISCAL</h4> Su clave venció')).toBe('cambio_clave');
    expect(detectarFalloLogin('<img src="captcha.jpg"><input name="F1:captcha" value="">Ingresá el código de la imagen')).toBe('captcha');
    expect(detectarFalloLogin('Ingresá el código de tu app Token ARCA (doble factor)')).toBe('segundo_factor');
    expect(detectarFalloLogin('<input type="hidden" name="F1:captcha" value=""><input name="F1:password">')).toBeNull();
  });
});

describe('selección de representado', () => {
  it('lee el índice del onclick de la tarjeta hoverazul con el CUIT (no cuenta posiciones)', () => {
    expect(indiceRepresentado(INDEX_HTML, '30712093486')).toBe(2);
    expect(indiceRepresentado(INDEX_HTML, '30-71777827-4')).toBe(0);
  });
  it('si la empresa no está entre las personas, falla', () => {
    expect(() => indiceRepresentado(INDEX_HTML, '30718332148')).toThrow(/30-71833214-8/);
  });
  it('verifica la cabecera REPRESENTANDO A con el CUIT', () => {
    const ok = 'DIODATI JOSE [20-31419408-0] REPRESENTANDO A: EWWO CONSULTING S.R.L. [30-71209348-6]';
    expect(verificarRepresentando(ok, '30712093486')).toBe(true);
    expect(verificarRepresentando(ok, '30717778274')).toBe(false);
    expect(verificarRepresentando('<html>menú sin cabecera</html>', '30712093486')).toBe(false);
  });
});

describe('clasificarRespuestaAjax', () => {
  it('JSON válido', () => {
    const r = clasificarRespuestaAjax(200, 'application/json', '{"estado":"ok","datos":{"idConsulta":"1"}}');
    expect(r).toEqual({ tipo: 'json', json: { estado: 'ok', datos: { idConsulta: '1' } } });
  });
  it('sesión vencida: 200 con HTML "No se encuentra logueado"', () => {
    expect(clasificarRespuestaAjax(200, 'text/html', '<html>No se encuentra logueado al sistema o su sesión expiró</html>').tipo).toBe('sesion_vencida');
    expect(clasificarRespuestaAjax(403, 'text/html', '<html>Su sesión ha expirado</html>').tipo).toBe('sesion_vencida');
  });
  it('WAF: cuerpo BL… con timestamps, o 503 vacío', () => {
    expect(clasificarRespuestaAjax(200, '', 'BL2144953316145 2026-09-16 11:14:11 2026-09-16 11:14:11').tipo).toBe('waf');
    expect(clasificarRespuestaAjax(503, '', '').tipo).toBe('waf');
  });
  it('cualquier otra cosa es inesperada', () => {
    expect(clasificarRespuestaAjax(500, 'text/html', '<html>error</html>').tipo).toBe('inesperada');
  });
});

describe('rangoFechasPortal', () => {
  it('formatea dd/mm/yyyy - dd/mm/yyyy', () => {
    expect(rangoFechasPortal(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'))).toBe('01/08/2026 - 31/08/2026');
  });
  it('rechaza rangos de más de 365 días o invertidos', () => {
    expect(() => rangoFechasPortal(new Date('2025-01-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'))).toThrow(/365/);
    expect(() => rangoFechasPortal(new Date('2026-08-31T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))).toThrow();
  });
});
