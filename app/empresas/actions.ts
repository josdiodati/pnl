'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUsuario } from '@/lib/empresa/require-empresa';
import { cuitEsValido, normalizarCuit } from '@/lib/checks';
import { slugify } from '@/lib/format';

export type CrearEmpresaState = { error?: string };

// Any user can create a company and becomes its ADMINISTRADOR (doc 08).
export async function crearEmpresaAction(_prev: CrearEmpresaState, formData: FormData): Promise<CrearEmpresaState> {
  const usuario = await requireUsuario();
  const razonSocial = String(formData.get('razonSocial') ?? '').trim();
  const cuit = normalizarCuit(String(formData.get('cuit') ?? ''));
  const inicio = Number(formData.get('inicioEjercicioFiscal') ?? 7);

  if (!razonSocial) return { error: 'La razón social es obligatoria.' };
  if (!cuitEsValido(cuit)) return { error: 'El CUIT no es válido (verificá el dígito verificador).' };
  if (!(inicio >= 1 && inicio <= 12)) return { error: 'El mes de inicio del ejercicio debe estar entre 1 y 12.' };

  let slug = slugify(razonSocial);
  if (!slug) return { error: 'No se pudo derivar una URL a partir de la razón social.' };
  // Ensure unique slug
  for (let i = 0; await prisma.empresa.findUnique({ where: { slug } }); i++) {
    if (i > 20) return { error: 'No se pudo generar una URL única para la empresa.' };
    slug = `${slugify(razonSocial)}-${i + 2}`;
  }

  const empresa = await prisma.empresa.create({
    data: {
      razonSocial,
      cuit,
      slug,
      inicioEjercicioFiscal: inicio,
      usuarios: { create: { usuarioId: usuario.id, rol: 'ADMINISTRADOR' } },
    },
  });
  await prisma.auditLog.create({
    data: {
      empresaId: empresa.id,
      usuarioId: usuario.id,
      entidad: 'Empresa',
      entidadId: empresa.id,
      accion: 'CREAR',
      despues: { razonSocial, cuit, slug },
    },
  });
  redirect(`/${empresa.slug}/carga`);
}
