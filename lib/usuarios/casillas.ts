import type { CasillaUsuario } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { writeAudit } from '@/lib/audit';
import { DomainError } from '@/lib/errors';

// Casillas de mail de cada usuario (Configuración → Usuarios y roles). Por
// mail sólo se procesan los comprobantes que manda (o reenvía) una casilla de
// un usuario de la empresa —las asociadas acá o su email de login— y quedan
// cargados a su nombre. Una casilla pertenece a un solo usuario. Las
// administra un ADMINISTRADOR, sólo sobre miembros de su empresa.

const FORMATO_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "Juan Pérez <Juan@X.com>" o " Juan@X.com " -> "juan@x.com". */
export function normalizarEmail(email: string): string {
  const m = email.match(/<([^>]+)>/);
  return (m ? m[1] : email).trim().toLowerCase();
}

async function assertMiembro(empresaId: string, usuarioId: string): Promise<void> {
  const m = await prisma.usuarioEmpresa.findFirst({ where: { empresaId, usuarioId } });
  if (!m) throw new DomainError('El usuario no pertenece a esta empresa.');
}

export async function agregarCasilla(ctx: EmpresaContext, params: { usuarioId: string; email: string }): Promise<CasillaUsuario> {
  const email = normalizarEmail(params.email);
  if (!FORMATO_EMAIL.test(email)) throw new DomainError('Ingresá una dirección de mail válida.');
  await assertMiembro(ctx.empresa.id, params.usuarioId);

  const [casilla, login] = await Promise.all([
    prisma.casillaUsuario.findUnique({ where: { email }, include: { usuario: { select: { nombre: true } } } }),
    prisma.usuario.findUnique({ where: { email }, select: { id: true, nombre: true } }),
  ]);
  const dueno = casilla ? { id: casilla.usuarioId, nombre: casilla.usuario.nombre } : login;
  if (dueno) {
    throw new DomainError(
      dueno.id === params.usuarioId
        ? 'Esa casilla ya está asociada a este usuario.'
        : `Esa casilla ya está asociada a ${dueno.nombre}.`,
    );
  }

  const creada = await prisma.casillaUsuario.create({ data: { usuarioId: params.usuarioId, email, creadoPorId: ctx.usuario.id } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'CasillaUsuario',
    entidadId: creada.id,
    accion: 'AGREGAR_CASILLA',
    despues: { usuarioId: params.usuarioId, email },
  });
  return creada;
}

export async function quitarCasilla(ctx: EmpresaContext, casillaId: string): Promise<void> {
  const casilla = await prisma.casillaUsuario.findUnique({ where: { id: casillaId } });
  if (!casilla) throw new DomainError('Esa casilla ya no existe.');
  await assertMiembro(ctx.empresa.id, casilla.usuarioId);
  await prisma.casillaUsuario.delete({ where: { id: casillaId } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'CasillaUsuario',
    entidadId: casillaId,
    accion: 'QUITAR_CASILLA',
    antes: { usuarioId: casilla.usuarioId, email: casilla.email },
  });
}

/**
 * El usuario de la empresa dueño de esa casilla (asociada o email de login),
 * o null si no es de nadie o su dueño no pertenece a la empresa.
 */
export async function usuarioDeCasilla(empresaId: string, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const e = normalizarEmail(email);
  const miembro = await prisma.usuarioEmpresa.findFirst({
    where: {
      empresaId,
      usuario: { OR: [{ email: e }, { casillas: { some: { email: e } } }] },
    },
    select: { usuarioId: true },
  });
  return miembro?.usuarioId ?? null;
}
