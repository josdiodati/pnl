'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden, DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { cuitEsValido, normalizarCuit } from '@/lib/checks';
import { generarCodigoVinculo } from '@/lib/canales/telegram';
import type { Rol } from '@prisma/client';

// Company configuration: ADMINISTRADOR only (doc 08).

function volver(slug: string, err?: unknown, ok?: string): never {
  revalidatePath(`/${slug}/config`);
  if (err) {
    if (isDomainError(err) || isForbidden(err)) {
      redirect(`/${slug}/config?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/${slug}/config${ok ? `?ok=${encodeURIComponent(ok)}` : ''}`);
}

export async function editarEmpresaAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const razonSocial = String(formData.get('razonSocial') ?? '').trim();
    const cuit = normalizarCuit(String(formData.get('cuit') ?? ''));
    const inicio = Number(formData.get('inicioEjercicioFiscal') ?? 7);
    if (!razonSocial) throw new DomainError('La razón social es obligatoria.');
    if (!cuitEsValido(cuit)) throw new DomainError('CUIT inválido.');
    if (!(inicio >= 1 && inicio <= 12)) throw new DomainError('Mes de inicio inválido.');
    const antes = { razonSocial: ctx.empresa.razonSocial, cuit: ctx.empresa.cuit, inicioEjercicioFiscal: ctx.empresa.inicioEjercicioFiscal };
    await prisma.empresa.update({
      where: { id: ctx.empresa.id },
      data: { razonSocial, cuit, inicioEjercicioFiscal: inicio },
    });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Empresa',
      entidadId: ctx.empresa.id,
      accion: 'EDITAR',
      antes,
      despues: { razonSocial, cuit, inicioEjercicioFiscal: inicio },
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Datos de la empresa actualizados');
}

export async function invitarUsuarioAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const email = String(formData.get('email') ?? '').toLowerCase().trim();
    const rol = String(formData.get('rol')) as Rol;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError('Email inválido.');
    if (!['CARGADOR', 'VALIDADOR', 'ADMINISTRADOR'].includes(rol)) throw new DomainError('Rol inválido.');

    const yaMiembro = await prisma.usuarioEmpresa.findFirst({
      where: { empresaId: ctx.empresa.id, usuario: { email } },
    });
    if (yaMiembro) throw new DomainError('Ese usuario ya pertenece a la empresa.');

    const token = randomBytes(24).toString('hex');
    const invitacion = await ctx.db.invitacion.create({ data: { email, rol, token } as never });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Invitacion',
      entidadId: invitacion.id,
      accion: 'CREAR',
      despues: { email, rol },
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Invitación creada: copiá el enlace y enviáselo');
}

export async function cambiarRolAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const usuarioId = String(formData.get('usuarioId'));
    const rol = String(formData.get('rol')) as Rol;
    if (!['CARGADOR', 'VALIDADOR', 'ADMINISTRADOR'].includes(rol)) throw new DomainError('Rol inválido.');
    const membresia = await prisma.usuarioEmpresa.findFirst({
      where: { empresaId: ctx.empresa.id, usuarioId },
      include: { usuario: true },
    });
    if (!membresia) throw new DomainError('El usuario no pertenece a esta empresa.');
    if (membresia.rol === 'ADMINISTRADOR' && rol !== 'ADMINISTRADOR') {
      const admins = await prisma.usuarioEmpresa.count({ where: { empresaId: ctx.empresa.id, rol: 'ADMINISTRADOR' } });
      if (admins <= 1) throw new DomainError('La empresa necesita al menos un administrador.');
    }
    await prisma.usuarioEmpresa.update({ where: { id: membresia.id }, data: { rol } });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'UsuarioEmpresa',
      entidadId: membresia.usuarioId,
      accion: 'CAMBIAR_ROL',
      antes: { email: membresia.usuario.email, rol: membresia.rol },
      despues: { email: membresia.usuario.email, rol },
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Rol actualizado');
}

export async function generarCodigoTelegramAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'ADMINISTRADOR');
    const codigo = generarCodigoVinculo();
    await prisma.empresa.update({ where: { id: ctx.empresa.id }, data: { telegramCodigoVinculo: codigo } });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'Empresa',
      entidadId: ctx.empresa.id,
      accion: 'GENERAR_CODIGO_TELEGRAM',
    });
  } catch (err) {
    volver(slug, err);
  }
  volver(slug, undefined, 'Código de vínculo generado');
}
