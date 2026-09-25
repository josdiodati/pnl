import { describe, it, expect, vi } from 'vitest';

// Las rutas de subida responden siempre JSON: sin sesión, 401 legible (no el
// HTML del login, que el cliente leería como "sin respuesta"); sin permiso,
// 403; regla de negocio, 422.
vi.mock('@/lib/empresa/require-empresa', () => ({
  requireEmpresa: vi.fn(),
}));
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { conEmpresaJson, esRedirectNext } from '@/lib/subidas/ruta';
import { ForbiddenError, DomainError } from '@/lib/errors';

const mock = requireEmpresa as unknown as ReturnType<typeof vi.fn>;

describe('conEmpresaJson', () => {
  it('sin sesión (redirect de Next) responde 401 en JSON', async () => {
    mock.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }));
    const r = await conEmpresaJson('x', 'CARGADOR', async () => ({}));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/sesión/);
  });
  it('sin permiso 403, regla de negocio 422, éxito 200', async () => {
    mock.mockRejectedValueOnce(new ForbiddenError());
    expect((await conEmpresaJson('x', 'CARGADOR', async () => ({}))).status).toBe(403);
    mock.mockResolvedValueOnce({});
    expect((await conEmpresaJson('x', 'CARGADOR', async () => { throw new DomainError('no'); })).status).toBe(422);
    mock.mockResolvedValueOnce({});
    const ok = await conEmpresaJson('x', 'CARGADOR', async () => ({ ok: 1 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: 1 });
  });
  it('esRedirectNext reconoce sólo redirects', () => {
    expect(esRedirectNext({ digest: 'NEXT_REDIRECT;x' })).toBe(true);
    expect(esRedirectNext(new Error('otra cosa'))).toBe(false);
  });
});
