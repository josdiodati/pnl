import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { agregarCasilla, quitarCasilla, usuarioDeCasilla } from '@/lib/usuarios/casillas';
import { procesarEmailEntrante } from '@/lib/canales/email';

// Casillas de mail por usuario: sólo se procesan los comprobantes que llegan
// desde una casilla de un usuario de la empresa (o su email de login), y
// quedan cargados a su nombre.

const sufijo = `casillas-${Date.now()}`;
let empresaId = '';
let otraEmpresaId = '';
let admin = '';
let cargador = '';
let ajeno = '';
let ctx: EmpresaContext;

beforeAll(async () => {
  const mk = (n: string) => prisma.usuario.create({ data: { email: `${n}-${sufijo}@test.local`, nombre: n, passwordHash: 'x' } });
  [admin, cargador, ajeno] = (await Promise.all([mk('admin'), mk('cargador'), mk('ajeno')])).map((u) => u.id);
  const empresa = await prisma.empresa.create({
    data: {
      slug: sufijo, razonSocial: 'Casillas SA', cuit: '30714325651',
      usuarios: { create: [{ usuarioId: admin, rol: 'ADMINISTRADOR' }, { usuarioId: cargador, rol: 'CARGADOR' }] },
    },
  });
  empresaId = empresa.id;
  otraEmpresaId = (await prisma.empresa.create({
    data: { slug: `${sufijo}-otra`, razonSocial: 'Otra SA', cuit: '30714325651', usuarios: { create: [{ usuarioId: ajeno, rol: 'CARGADOR' }] } },
  })).id;
  const u = await prisma.usuario.findUniqueOrThrow({ where: { id: admin } });
  ctx = { empresa, usuario: { id: u.id, email: u.email, nombre: u.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
});
afterAll(async () => {
  const ids = [empresaId, otraEmpresaId];
  await prisma.job.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.movimiento.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.loteIngesta.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.usuarioEmpresa.deleteMany({ where: { empresaId: { in: ids } } });
  await prisma.empresa.deleteMany({ where: { id: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: [admin, cargador, ajeno] } } }); // casillas en cascada
});

describe('casillas por usuario', () => {
  it('agrega una casilla normalizada y la audita', async () => {
    const c = await agregarCasilla(ctx, { usuarioId: cargador, email: `  Facturas.${sufijo}@Gmail.com ` });
    expect(c.email).toBe(`facturas.${sufijo}@gmail.com`);
    expect(await prisma.auditLog.count({ where: { empresaId, accion: 'AGREGAR_CASILLA', entidadId: c.id } })).toBe(1);
  });

  it('rechaza un mail inválido, repetido o que es el login de otro usuario', async () => {
    await expect(agregarCasilla(ctx, { usuarioId: cargador, email: 'no-es-un-mail' })).rejects.toThrow(/válid/);
    await expect(agregarCasilla(ctx, { usuarioId: admin, email: `facturas.${sufijo}@gmail.com` })).rejects.toThrow(/ya está asociada/);
    await expect(agregarCasilla(ctx, { usuarioId: cargador, email: `admin-${sufijo}@test.local` })).rejects.toThrow(/ya está asociada/);
  });

  it('sólo sobre usuarios de la empresa', async () => {
    await expect(agregarCasilla(ctx, { usuarioId: ajeno, email: `x.${sufijo}@gmail.com` })).rejects.toThrow(/no pertenece/);
  });

  it('usuarioDeCasilla: por casilla asociada o por email de login, sin importar mayúsculas; sólo miembros', async () => {
    expect(await usuarioDeCasilla(empresaId, `FACTURAS.${sufijo}@gmail.com`)).toBe(cargador);
    expect(await usuarioDeCasilla(empresaId, `Carga Kawellu <facturas.${sufijo}@gmail.com>`)).toBe(cargador);
    expect(await usuarioDeCasilla(empresaId, `admin-${sufijo}@test.local`)).toBe(admin);
    expect(await usuarioDeCasilla(empresaId, `ajeno-${sufijo}@test.local`)).toBeNull(); // existe pero es de otra empresa
    expect(await usuarioDeCasilla(empresaId, 'proveedor@desconocido.com')).toBeNull();
    expect(await usuarioDeCasilla(empresaId, null)).toBeNull();
  });

  it('quitar una casilla deja de reconocerla', async () => {
    const c = await agregarCasilla(ctx, { usuarioId: cargador, email: `temporal.${sufijo}@gmail.com` });
    await quitarCasilla(ctx, c.id);
    expect(await usuarioDeCasilla(empresaId, `temporal.${sufijo}@gmail.com`)).toBeNull();
    expect(await prisma.auditLog.count({ where: { empresaId, accion: 'QUITAR_CASILLA', entidadId: c.id } })).toBe(1);
  });

  it('no se puede quitar la casilla de un usuario de otra empresa', async () => {
    const ctxOtra = { ...ctx, empresa: { ...ctx.empresa, id: otraEmpresaId }, db: scopedDb(otraEmpresaId) } as EmpresaContext;
    const c = await prisma.casillaUsuario.create({ data: { usuarioId: cargador, email: `protegida.${sufijo}@gmail.com` } });
    await expect(quitarCasilla(ctxOtra, c.id)).rejects.toThrow(/no pertenece/);
  });
});

describe('procesarEmailEntrante', () => {
  const adjunto = (n: string) => ({ nombre: n, contentType: 'application/pdf', contenidoBase64: Buffer.from(`%PDF ${sufijo} ${n}`).toString('base64') });

  it('carga el comprobante a nombre del dueño de la casilla', async () => {
    await procesarEmailEntrante({ messageId: `m1-${sufijo}`, from: `facturas.${sufijo}@gmail.com`, to: `comprobantes+${sufijo}@ledger.ar`, adjuntos: [adjunto('a.pdf')] });
    const mov = await prisma.movimiento.findFirstOrThrow({ where: { empresaId, archivoNombre: 'a.pdf' } });
    expect(mov.creadoPorId).toBe(cargador);
    expect(mov.canalIngreso).toBe('EMAIL');
  });

  it('un remitente que no es casilla de un usuario de la empresa se ignora (nada se carga)', async () => {
    await procesarEmailEntrante({ messageId: `m2-${sufijo}`, from: 'proveedor@desconocido.com', to: `comprobantes+${sufijo}@ledger.ar`, adjuntos: [adjunto('b.pdf')] });
    expect(await prisma.movimiento.count({ where: { empresaId, archivoNombre: 'b.pdf' } })).toBe(0);
  });
});
