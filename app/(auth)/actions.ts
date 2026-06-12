'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { signIn } from '@/lib/auth';
import { hashPassword } from '@/lib/auth/password';

export type AuthFormState = { error?: string };

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirectTo: '/empresas' });
    return {};
  } catch (err) {
    if (err instanceof AuthError) return { error: 'Email o contraseña incorrectos.' };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function registroAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const nombre = String(formData.get('nombre') ?? '').trim();
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  if (!nombre || !email || !password) return { error: 'Completá nombre, email y contraseña.' };
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Email inválido.' };

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) return { error: 'Ya existe un usuario con ese email.' };

  await prisma.usuario.create({
    data: { nombre, email, passwordHash: await hashPassword(password) },
  });

  try {
    await signIn('credentials', { email, password, redirectTo: '/empresas' });
    return {};
  } catch (err) {
    if (err instanceof AuthError) return { error: 'Usuario creado pero no se pudo iniciar sesión; probá desde Ingresar.' };
    throw err;
  }
}

export async function aceptarInvitacionAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get('token') ?? '');
  const nombre = String(formData.get('nombre') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  const invitacion = await prisma.invitacion.findUnique({ where: { token }, include: { empresa: true } });
  if (!invitacion || invitacion.aceptada) return { error: 'Invitación inválida o ya utilizada.' };

  let usuario = await prisma.usuario.findUnique({ where: { email: invitacion.email } });
  if (!usuario) {
    if (!nombre || !password) return { error: 'Completá tu nombre y una contraseña para crear tu cuenta.' };
    if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
    usuario = await prisma.usuario.create({
      data: { nombre, email: invitacion.email, passwordHash: await hashPassword(password) },
    });
  }

  const yaEsMiembro = await prisma.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: invitacion.empresaId } },
  });
  if (!yaEsMiembro) {
    await prisma.usuarioEmpresa.create({
      data: { usuarioId: usuario.id, empresaId: invitacion.empresaId, rol: invitacion.rol },
    });
    await prisma.auditLog.create({
      data: {
        empresaId: invitacion.empresaId,
        usuarioId: usuario.id,
        entidad: 'UsuarioEmpresa',
        entidadId: usuario.id,
        accion: 'ACEPTAR_INVITACION',
        despues: { email: invitacion.email, rol: invitacion.rol },
      },
    });
  }
  await prisma.invitacion.update({ where: { id: invitacion.id }, data: { aceptada: true } });

  if (password) {
    try {
      await signIn('credentials', { email: invitacion.email, password, redirectTo: '/empresas' });
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
    }
  }
  redirect('/login');
}
