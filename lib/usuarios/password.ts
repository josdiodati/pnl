import { prisma } from '@/lib/db';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { hashPassword } from '@/lib/auth/password';
import { writeAudit } from '@/lib/audit';
import { DomainError } from '@/lib/errors';

// Restablecimiento de contraseña desde Configuración → Usuarios (ADMINISTRADOR).
// La contraseña es de la cuenta (vale para todas las empresas del usuario), por
// eso sólo se permite sobre miembros de la empresa desde la que se opera y el
// rastro de auditoría nunca incluye la clave. Misma regla que el alta: ≥ 8 chars.

export const PASSWORD_MIN = 8;

export function validarNuevaPassword(nueva: string, repetir: string): void {
  if (nueva.trim().length < PASSWORD_MIN) throw new DomainError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
  if (nueva !== repetir) throw new DomainError('Las contraseñas no coinciden.');
}

export async function restablecerPassword(
  ctx: EmpresaContext,
  params: { usuarioId: string; nueva: string; repetir: string },
): Promise<{ email: string }> {
  validarNuevaPassword(params.nueva, params.repetir);
  const membresia = await prisma.usuarioEmpresa.findFirst({
    where: { empresaId: ctx.empresa.id, usuarioId: params.usuarioId },
    include: { usuario: true },
  });
  if (!membresia) throw new DomainError('El usuario no pertenece a esta empresa.');

  await prisma.usuario.update({ where: { id: membresia.usuarioId }, data: { passwordHash: await hashPassword(params.nueva) } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Usuario',
    entidadId: membresia.usuarioId,
    accion: 'RESTABLECER_PASSWORD',
    despues: { email: membresia.usuario.email, propia: membresia.usuarioId === ctx.usuario.id },
  });
  return { email: membresia.usuario.email };
}
