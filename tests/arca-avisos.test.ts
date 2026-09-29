import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { ErrorLoginArca, ErrorPortalArca } from '@/lib/arca/portal/cliente';

// Problemas de la empresa con Mis Comprobantes -> mail a sus administradores:
// la clave bloqueada en el sync AUTOMÁTICO (en uno manual la persona ya lo ve
// en pantalla) y el sync que falla 3 veces seguidas (también al owner).

const notificar = vi.fn();
vi.mock('@/lib/notificaciones', () => ({ notificar }));
const { guardarCredencialArca, sincronizarMisComprobantes } = await import('@/lib/arca/mis-comprobantes/service');

const sufijo = `arca-avisos-${Date.now()}`;
let ctx: EmpresaContext;
let empresaId = '';
let usuarioId = '';

beforeAll(async () => {
  process.env.ARCA_PORTAL_SECRET = Buffer.alloc(32, 3).toString('hex');
  const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Avisos', passwordHash: 'x' } });
  usuarioId = usuario.id;
  const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Avisos SRL', cuit: '30712093486' } });
  empresaId = empresa.id;
  ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
});
beforeEach(async () => {
  notificar.mockReset();
  await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'x' });
  await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'OK', erroresSeguidos: 0 } });
});
afterAll(async () => {
  await prisma.credencialArca.deleteMany({ where: { empresaId } });
  await prisma.auditLog.deleteMany({ where: { empresaId } });
  await prisma.empresa.delete({ where: { id: empresaId } });
  await prisma.usuario.delete({ where: { id: usuarioId } });
});

const loginRechazado = { descargar: async () => { throw new ErrorLoginArca('credenciales', 'ARCA rechazó el usuario o la Clave Fiscal.'); } };
const portalCaido = { descargar: async () => { throw new ErrorPortalArca('Respuesta inesperada de Mis Comprobantes'); } };

describe('avisos de Mis Comprobantes', () => {
  it('clave bloqueada en el sync automático: avisa a los administradores con el motivo', async () => {
    await sincronizarMisComprobantes(empresaId, {}, loginRechazado);
    expect(notificar).toHaveBeenCalledOnce();
    const [destino, asunto, texto] = notificar.mock.calls[0];
    expect(destino).toEqual({ tipo: 'EMPRESA', empresaId });
    expect(asunto).toMatch(/Avisos SRL/);
    expect(texto).toMatch(/rechazó el usuario o la Clave Fiscal/);
    expect(texto).toContain(`/${sufijo}/arca`);
  });

  it('clave bloqueada en un sync manual: no manda mail (la persona lo ve en pantalla)', async () => {
    await sincronizarMisComprobantes(empresaId, { usuarioId }, loginRechazado);
    expect(notificar).not.toHaveBeenCalled();
  });

  it('errores del portal: avisa una sola vez, al tercero seguido, a los admins y al owner', async () => {
    for (let i = 0; i < 4; i++) await sincronizarMisComprobantes(empresaId, {}, portalCaido).catch(() => {});
    expect(notificar).toHaveBeenCalledOnce();
    const [destinos, asunto, texto] = notificar.mock.calls[0];
    expect(destinos).toEqual([{ tipo: 'EMPRESA', empresaId }, { tipo: 'APP' }]);
    expect(asunto).toMatch(/Mis Comprobantes/);
    expect(texto).toMatch(/inesperada/);
  });
});
