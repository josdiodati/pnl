// Seed real (etapa captura de comprobantes): un usuario real administrador de
// dos empresas reales, con maestros mínimos. Los movimientos reales entran por
// el import masivo (scripts/import-comprobantes.ts), no por el seed.
// Run: npx prisma db seed   (idempotente: salta si ya existe el usuario).
import { PrismaClient, type TipoCategoria } from '@prisma/client';
import { hashPassword } from '../lib/auth/password';

const prisma = new PrismaClient();

const PASSWORD_DEMO = 'kawellu1234'; // documentado en README; cambiar tras el primer login

const NOMBRES_CATEGORIAS: [string, TipoCategoria][] = [
  ['Ventas Servicios', 'INGRESO'],
  ['Ventas Hardware', 'INGRESO'],
  ['Sueldos', 'EGRESO'],
  ['Adicionales Salarios', 'EGRESO'],
  ['IT & COM Services', 'EGRESO'],
  ['Office Supplies', 'EGRESO'],
  ['Office Expenditure', 'EGRESO'],
  ['Combustible y Movilidad', 'EGRESO'],
  ['Representación', 'EGRESO'],
  ['Legales', 'EGRESO'],
  ['Contables', 'EGRESO'],
  ['Impuestos', 'EGRESO'],
  ['Gastos Bancarios', 'EGRESO'],
  ['Servicios Cloud / SaaS', 'EGRESO'],
  ['Misceláneos', 'EGRESO'],
];

async function crearMaestros(empresaId: string) {
  for (const [nombre, tipo] of NOMBRES_CATEGORIAS) {
    await prisma.categoria.create({ data: { empresaId, nombre, tipo } });
  }
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } });
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'SF', tipo: 'NEGOCIO' } });
  await prisma.centroCosto.create({ data: { empresaId, nombre: 'Administración', tipo: 'SOPORTE' } });
}

async function main() {
  const EMAIL = 'jose.diodati@gmail.com';
  if (await prisma.usuario.findUnique({ where: { email: EMAIL } })) {
    console.log('El seed ya fue aplicado (existe %s). Nada que hacer.', EMAIL);
    return;
  }

  const passwordHash = await hashPassword(PASSWORD_DEMO);
  const jose = await prisma.usuario.create({
    data: { email: EMAIL, nombre: 'Jose Diodati', passwordHash },
  });

  const kawellu = await prisma.empresa.create({
    data: {
      slug: 'kawellu',
      razonSocial: 'Kawellu Soluciones S.R.L.',
      cuit: '30718332148',
      inicioEjercicioFiscal: 1,
      usuarios: { create: [{ usuarioId: jose.id, rol: 'ADMINISTRADOR' }] },
    },
  });

  // CUIT placeholder VÁLIDO (dígito verificador correcto). Editar en Configuración.
  const ewwo = await prisma.empresa.create({
    data: {
      slug: 'ewwo',
      razonSocial: 'Ewwo Consulting S.R.L.',
      cuit: '30712093486',
      inicioEjercicioFiscal: 1,
      usuarios: { create: [{ usuarioId: jose.id, rol: 'ADMINISTRADOR' }] },
    },
  });

  await crearMaestros(kawellu.id);
  await crearMaestros(ewwo.id);

  console.log('Seed real aplicado ✔');
  console.log('  Usuario: %s (password: %s) — admin de Kawellu y Ewwo', EMAIL, PASSWORD_DEMO);
  console.log('  Empresas: kawellu (CUIT 30718332148), ewwo (CUIT placeholder 30712093486 — editar en Configuración)');
  console.log('  Maestros mínimos creados. Cargá comprobantes reales con: npx tsx scripts/import-comprobantes.ts kawellu');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
