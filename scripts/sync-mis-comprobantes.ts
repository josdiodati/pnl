import { prisma } from '@/lib/db';
import { sincronizarMisComprobantes, ventanaSyncDiaria } from '@/lib/arca/mis-comprobantes/service';

// Corrida manual de "Mis Comprobantes" de ARCA para una empresa con un rango
// a elección (máx. 365 días; ARCA publica hasta ayer). Un único login, igual
// que el job diario: si ARCA rechaza la clave, la credencial queda BLOQUEADA
// y hay que revisarla en Configuración.
//
//   npx tsx scripts/sync-mis-comprobantes.ts --empresa ewwo --desde 2026-07-01 [--hasta 2026-09-15]

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('empresa');
  const desdeTexto = arg('desde');
  if (!slug || !desdeTexto) throw new Error('Uso: --empresa <slug> --desde YYYY-MM-DD [--hasta YYYY-MM-DD]');
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { slug } });
  const desde = new Date(`${desdeTexto}T00:00:00Z`);
  const hasta = arg('hasta') ? new Date(`${arg('hasta')}T00:00:00Z`) : ventanaSyncDiaria().hasta;
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) throw new Error('Fechas inválidas.');
  console.log(`Sync Mis Comprobantes · ${empresa.razonSocial} (${empresa.cuit}) · ${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)}`);
  const inicio = Date.now();
  const r = await sincronizarMisComprobantes(empresa.id, { desde, hasta, usuarioId: null });
  console.log(JSON.stringify(r, null, 2));
  console.log(`Duración: ${Math.round((Date.now() - inicio) / 1000)} s`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
