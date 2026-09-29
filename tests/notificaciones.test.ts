import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

// Ruteo de avisos por mail: carga -> quien cargó; empresa -> sus
// administradores; aplicación -> el owner (APP_OWNER_EMAIL).

const enviarEmail = vi.fn();
let habilitado = true;
vi.mock('@/lib/canales/resend', () => ({ enviarEmail, resendHabilitado: () => habilitado }));
const { destinatarios, notificar, notificarErrorCarga } = await import('@/lib/notificaciones');

const sufijo = `notif-${Date.now()}`;
let empresaId = '';
let adminA = '';
let adminB = '';
let cargador = '';

beforeAll(async () => {
  const mk = (n: string) => prisma.usuario.create({ data: { email: `${n}-${sufijo}@test.local`, nombre: n, passwordHash: 'x' } });
  [adminA, adminB, cargador] = (await Promise.all([mk('admin-a'), mk('admin-b'), mk('cargador')])).map((u) => u.id);
  const empresa = await prisma.empresa.create({
    data: {
      slug: sufijo, razonSocial: 'Notif SA', cuit: '30714325651',
      usuarios: { create: [{ usuarioId: adminA, rol: 'ADMINISTRADOR' }, { usuarioId: adminB, rol: 'ADMINISTRADOR' }, { usuarioId: cargador, rol: 'CARGADOR' }] },
    },
  });
  empresaId = empresa.id;
});
beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
  habilitado = true;
  process.env.APP_OWNER_EMAIL = 'owner@test.local';
});
afterAll(async () => {
  delete process.env.APP_OWNER_EMAIL;
  await prisma.movimiento.deleteMany({ where: { empresaId } });
  await prisma.usuarioEmpresa.deleteMany({ where: { empresaId } });
  await prisma.empresa.delete({ where: { id: empresaId } });
  await prisma.usuario.deleteMany({ where: { id: { in: [adminA, adminB, cargador] } } });
});

describe('destinatarios', () => {
  it('APP es el owner', async () => {
    expect(await destinatarios({ tipo: 'APP' })).toEqual(['owner@test.local']);
  });

  it('APP sin APP_OWNER_EMAIL no tiene destinatarios', async () => {
    delete process.env.APP_OWNER_EMAIL;
    expect(await destinatarios({ tipo: 'APP' })).toEqual([]);
  });

  it('EMPRESA son sólo sus administradores', async () => {
    expect((await destinatarios({ tipo: 'EMPRESA', empresaId })).sort()).toEqual([`admin-a-${sufijo}@test.local`, `admin-b-${sufijo}@test.local`]);
  });

  it('USUARIO es ese usuario; inexistente no rompe', async () => {
    expect(await destinatarios({ tipo: 'USUARIO', usuarioId: cargador })).toEqual([`cargador-${sufijo}@test.local`]);
    expect(await destinatarios({ tipo: 'USUARIO', usuarioId: 'no-existe' })).toEqual([]);
  });
});

describe('notificar', () => {
  it('junta varios destinos en un solo mail sin repetir casillas', async () => {
    await notificar([{ tipo: 'EMPRESA', empresaId }, { tipo: 'USUARIO', usuarioId: adminA }, { tipo: 'APP' }], 'Asunto', 'Texto');
    expect(enviarEmail).toHaveBeenCalledOnce();
    const m = enviarEmail.mock.calls[0][0];
    expect(m.to).toHaveLength(3);
    expect(m.to).toContain('owner@test.local');
    expect(m.subject).toBe('Asunto');
    expect(m.text).toMatch(/^Texto\n\n— P&L Manager · https:\/\/pnl\.ledger\.ar$/);
  });

  it('sin destinatarios o sin Resend no manda nada', async () => {
    delete process.env.APP_OWNER_EMAIL;
    await notificar({ tipo: 'APP' }, 'a', 'b');
    process.env.APP_OWNER_EMAIL = 'owner@test.local';
    habilitado = false;
    await notificar({ tipo: 'APP' }, 'a', 'b');
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it('si Resend falla no lanza', async () => {
    enviarEmail.mockRejectedValue(new Error('Resend 500'));
    await expect(notificar({ tipo: 'APP' }, 'a', 'b')).resolves.toBeUndefined();
  });
});

describe('notificarErrorCarga', () => {
  it('comprobante con error: avisa a quien lo cargó, con el archivo y el error', async () => {
    const mov = await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', creadoPorId: cargador, archivoNombre: 'factura-luz.pdf' },
    });
    await notificarErrorCarga('EXTRACCION', { movimientoId: mov.id, empresaId }, '[DOCUMENTO_RECHAZADO] La API rechazó este documento.');
    expect(enviarEmail).toHaveBeenCalledOnce();
    const m = enviarEmail.mock.calls[0][0];
    expect(m.to).toEqual([`cargador-${sufijo}@test.local`]);
    expect(m.subject).toContain('factura-luz.pdf');
    expect(m.text).toContain('DOCUMENTO_RECHAZADO');
    expect(m.text).toContain(`/${sufijo}/carga`);
  });

  it('recibo con error: avisa al usuarioId del job, con la página', async () => {
    await notificarErrorCarga('EXTRACCION_RECIBO', { empresaId, usuarioId: cargador, archivoNombre: 'recibos-ago.pdf', pagina: 3 }, 'boom');
    const m = enviarEmail.mock.calls[0][0];
    expect(m.to).toEqual([`cargador-${sufijo}@test.local`]);
    expect(m.subject).toContain('recibos-ago.pdf');
    expect(m.text).toContain('página 3');
  });

  it('sin usuario identificable no manda nada', async () => {
    await notificarErrorCarga('EXTRACCION_RESUMEN', { empresaId, resumenId: 'no-existe' }, 'boom');
    expect(enviarEmail).not.toHaveBeenCalled();
  });
});
