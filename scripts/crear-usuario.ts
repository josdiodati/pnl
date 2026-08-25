/**
 * Da de alta un usuario (o lo actualiza si ya existe) y lo vincula a una o
 * más empresas con el rol indicado.
 *
 * Uso:  npx tsx scripts/crear-usuario.ts <email> <nombre> <password> <rol> <slug> [slug...]
 *
 * Ej:   npx tsx scripts/crear-usuario.ts cgodoy@kawellu.com.ar "Carolina Godoy" secreta ADMINISTRADOR ewwo kawellu
 */
import { prisma } from '../lib/db';
import { hashPassword } from '../lib/auth/password';
import type { Rol } from '@prisma/client';

const ROLES = ['CARGADOR', 'VALIDADOR', 'ADMINISTRADOR'] as const;

async function main() {
  const [email, nombre, password, rol, ...slugs] = process.argv.slice(2);
  if (!email || !nombre || !password || !rol || slugs.length === 0) {
    throw new Error('Uso: crear-usuario.ts <email> <nombre> <password> <rol> <slug> [slug...]');
  }
  if (!ROLES.includes(rol as (typeof ROLES)[number])) {
    throw new Error(`Rol inválido "${rol}". Válidos: ${ROLES.join(', ')}`);
  }

  const empresas = await prisma.empresa.findMany({ where: { slug: { in: slugs } } });
  const faltantes = slugs.filter((s) => !empresas.some((e) => e.slug === s));
  if (faltantes.length) throw new Error(`No existen las empresas: ${faltantes.join(', ')}`);

  const emailNorm = email.toLowerCase().trim();
  const passwordHash = await hashPassword(password);
  const usuario = await prisma.usuario.upsert({
    where: { email: emailNorm },
    create: { email: emailNorm, nombre, passwordHash },
    update: { nombre, passwordHash },
  });

  for (const empresa of empresas) {
    await prisma.usuarioEmpresa.upsert({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } },
      create: { usuarioId: usuario.id, empresaId: empresa.id, rol: rol as Rol },
      update: { rol: rol as Rol },
    });
    console.log(`✔ ${emailNorm} → ${empresa.slug} (${rol})`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
