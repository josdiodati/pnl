import { redirect } from 'next/navigation';
import type { Empresa, Rol } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';
import { rolAlcanza } from '@/lib/roles';
import { scopedDb, type ScopedDb } from './scope';

export type UsuarioSesion = { id: string; email: string; nombre: string };

export type EmpresaContext = {
  empresa: Empresa;
  usuario: UsuarioSesion;
  rol: Rol;
  /** Prisma client hard-scoped to this company. ALL data access goes through it. */
  db: ScopedDb;
};

/** Requires an authenticated session (no company context). */
export async function requireUsuario(): Promise<UsuarioSesion> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) redirect('/login');
  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) redirect('/login');
  return { id: usuario.id, email: usuario.email, nombre: usuario.nombre };
}

/**
 * Central multi-company gate. Resolves the active company from the URL slug,
 * verifies the user belongs to it with at least `rolMinimo`, and returns a
 * data client already scoped to that company. Every page, server action and
 * route handler under /[empresaSlug] MUST call this. Throws ForbiddenError
 * (HTTP 403) on any violation — a record from another company can never leak.
 */
export async function requireEmpresa(empresaSlug: string, rolMinimo: Rol = 'CARGADOR'): Promise<EmpresaContext> {
  const usuario = await requireUsuario();
  const membership = await prisma.usuarioEmpresa.findFirst({
    where: { usuarioId: usuario.id, empresa: { slug: empresaSlug } },
    include: { empresa: true },
  });
  if (!membership) throw new ForbiddenError();
  if (!rolAlcanza(membership.rol, rolMinimo)) {
    throw new ForbiddenError('Tu rol en esta empresa no alcanza para esta acción.');
  }
  return {
    empresa: membership.empresa,
    usuario,
    rol: membership.rol,
    db: scopedDb(membership.empresa.id),
  };
}

/**
 * Page variant: renders the 403 screen instead of bubbling the error.
 * Mutations and APIs use requireEmpresa directly and return real HTTP 403.
 */
export async function requireEmpresaPage(empresaSlug: string, rolMinimo: Rol = 'CARGADOR'): Promise<EmpresaContext> {
  try {
    return await requireEmpresa(empresaSlug, rolMinimo);
  } catch (err) {
    if (err instanceof ForbiddenError) redirect('/403');
    throw err;
  }
}
