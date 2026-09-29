import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { clasificarErrorIa, mensajeErrorIa } from '@/lib/ia/errores';

// Construye el error tal como lo arma el SDK a partir de la respuesta HTTP.
function errorApi(status: number, tipo: string, mensaje: string, requestId = 'req_011abc') {
  const body = { type: 'error', error: { type: tipo, message: mensaje } };
  const headers = { 'request-id': requestId };
  return Anthropic.APIError.generate(status, body, undefined, headers as never);
}

describe('clasificarErrorIa', () => {
  it('sin crédito: 400 "credit balance is too low" es GLOBAL', () => {
    const e = clasificarErrorIa(errorApi(400, 'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'));
    expect(e).toMatchObject({ codigo: 'SIN_CREDITO', alcance: 'GLOBAL', status: 400, tipoApi: 'invalid_request_error', requestId: 'req_011abc' });
    expect(e!.titulo).toMatch(/crédito/i);
  });

  it('límite de gasto: 400 "usage limits" es GLOBAL', () => {
    const e = clasificarErrorIa(errorApi(400, 'invalid_request_error',
      'You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.'));
    expect(e).toMatchObject({ codigo: 'LIMITE_GASTO', alcance: 'GLOBAL' });
  });

  it('clave inválida o revocada: 401', () => {
    expect(clasificarErrorIa(errorApi(401, 'authentication_error', 'invalid x-api-key'))).toMatchObject({ codigo: 'CLAVE_INVALIDA', alcance: 'GLOBAL' });
  });

  it('sin permiso: 403', () => {
    expect(clasificarErrorIa(errorApi(403, 'permission_error', 'Your API key does not have permission'))).toMatchObject({ codigo: 'SIN_PERMISO', alcance: 'GLOBAL' });
  });

  it('modelo inexistente o retirado: 404', () => {
    expect(clasificarErrorIa(errorApi(404, 'not_found_error', 'model: claude-viejo'))).toMatchObject({ codigo: 'MODELO_INEXISTENTE', alcance: 'GLOBAL' });
  });

  it('límite de velocidad, sobrecarga y error interno son TRANSITORIOS', () => {
    expect(clasificarErrorIa(errorApi(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'))).toMatchObject({ codigo: 'LIMITE_VELOCIDAD', alcance: 'TRANSITORIO' });
    expect(clasificarErrorIa(errorApi(529, 'overloaded_error', 'Overloaded'))).toMatchObject({ codigo: 'API_SOBRECARGADA', alcance: 'TRANSITORIO' });
    expect(clasificarErrorIa(errorApi(500, 'api_error', 'Internal server error'))).toMatchObject({ codigo: 'ERROR_INTERNO_API', alcance: 'TRANSITORIO' });
  });

  it('sin conexión / timeout es TRANSITORIO', () => {
    expect(clasificarErrorIa(new Anthropic.APIConnectionError({ message: 'Connection error.' }))).toMatchObject({ codigo: 'SIN_CONEXION', alcance: 'TRANSITORIO' });
    expect(clasificarErrorIa(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ codigo: 'SIN_CONEXION', alcance: 'TRANSITORIO' });
  });

  it('otro 400 o un 413 es problema del DOCUMENTO', () => {
    expect(clasificarErrorIa(errorApi(400, 'invalid_request_error', 'messages.0.content.0.pdf: invalid PDF'))).toMatchObject({ codigo: 'DOCUMENTO_RECHAZADO', alcance: 'DOCUMENTO' });
    expect(clasificarErrorIa(errorApi(413, 'request_too_large', 'Request exceeds the maximum allowed number of bytes'))).toMatchObject({ codigo: 'DOCUMENTO_RECHAZADO', alcance: 'DOCUMENTO' });
  });

  it('un error que no es de la API devuelve null', () => {
    expect(clasificarErrorIa(new Error('Movimiento sin archivo para procesar'))).toBeNull();
    expect(clasificarErrorIa('texto')).toBeNull();
  });

  it('mensajeErrorIa nombra el código, la explicación, el texto de la API y el request id', () => {
    const e = clasificarErrorIa(errorApi(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'))!;
    const m = mensajeErrorIa(e);
    expect(m).toMatch(/^\[SIN_CREDITO\] /);
    expect(m).toContain('Your credit balance is too low');
    expect(m).toContain('req_011abc');
  });
});
