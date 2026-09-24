import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { restablecerPassword, validarNuevaPassword } from '@/lib/usuarios/password';

// Un administrador puede restablecer la contraseña de cualquier miembro de su
// empresa (incluida la propia) desde Configuración. La contraseña es de la
// cuenta, así que vale para todas las empresas del usuario; nunca se audita
// en claro.

describe('validarNuevaPassword', () => {
  it('exige al menos 8 caracteres y que coincida la repetición', () => {
    expect(() => validarNuevaPassword('corta', 'corta')).toThrow(DomainError);
    expect(() => validarNuevaPassword('12345678', '12345679')).toThrow(DomainError);
    expect(() => validarNuevaPassword('   ', '   ')).toThrow(DomainError);
    expect(() => validarNuevaPassword('clave-segura-1', 'clave-segura-1')).not.toThrow();
  });
});

describe('restablecerPassword', () => {
  const sufijo = `pw-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let adminId: string;
  let miembroId: string;
  let ajenoId: string;

  beforeAll(async () => {
    const admin = await prisma.usuario.create({ data: { email: `${sufijo}-admin@test.local`, nombre: 'Admin', passwordHash: 'x' } });
    const miembro = await prisma.usuario.create({ data: { email: `${sufijo}-m@test.local`, nombre: 'Miembro', passwordHash: 'x' } });
    const ajeno = await prisma.usuario.create({ data: { email: `${sufijo}-ajeno@test.local`, nombre: 'Ajeno', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'PW Test', cuit: '30712093486' } });
    empresaId = empresa.id;
    adminId = admin.id;
    miembroId = miembro.id;
    ajenoId = ajeno.id;
    await prisma.usuarioEmpresa.createMany({
      data: [
        { usuarioId: adminId, empresaId, rol: 'ADMINISTRADOR' },
        { usuarioId: miembroId, empresaId, rol: 'CARGADOR' },
      ],
    });
    ctx = { empresa, usuario: { id: adminId, email: admin.email, nombre: admin.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.usuarioEmpresa.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { id: { in: [adminId, miembroId, ajenoId] } } });
  });

  it('guarda la nueva contraseña hasheada de un miembro y deja rastro sin la clave', async () => {
    await restablecerPassword(ctx, { usuarioId: miembroId, nueva: 'nueva-clave-99', repetir: 'nueva-clave-99' });
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: miembroId } });
    expect(u.passwordHash).not.toBe('x');
    expect(await verifyPassword('nueva-clave-99', u.passwordHash)).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { empresaId, entidad: 'Usuario', entidadId: miembroId, accion: 'RESTABLECER_PASSWORD' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('nueva-clave-99');
  });

  it('permite cambiar la propia', async () => {
    await restablecerPassword(ctx, { usuarioId: adminId, nueva: 'mi-clave-nueva', repetir: 'mi-clave-nueva' });
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: adminId } });
    expect(await verifyPassword('mi-clave-nueva', u.passwordHash)).toBe(true);
  });

  it('rechaza a un usuario que no pertenece a la empresa', async () => {
    await expect(restablecerPassword(ctx, { usuarioId: ajenoId, nueva: 'clave-valida-1', repetir: 'clave-valida-1' })).rejects.toThrow(DomainError);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: ajenoId } });
    expect(u.passwordHash).toBe('x');
  });

  it('rechaza contraseñas inválidas sin tocar la actual', async () => {
    await expect(restablecerPassword(ctx, { usuarioId: miembroId, nueva: 'corta', repetir: 'corta' })).rejects.toThrow(DomainError);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: miembroId } });
    expect(await verifyPassword('nueva-clave-99', u.passwordHash)).toBe(true);
  });
});
