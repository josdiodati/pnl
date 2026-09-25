import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { rematchearResumen } from '@/lib/resumenes/ingesta';

// Recalcula el matching de las líneas no resueltas de todos los resúmenes de
// una empresa (lo mismo que el botón "Re-matchear", en lote). Útil después de
// cambiar el criterio de matching. Uso: npx tsx scripts/rematchear-resumenes.ts <slug>
async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Indicá el slug de la empresa.');
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { slug } });
  const resumenes = await prisma.resumen.findMany({ where: { empresaId: empresa.id, estado: 'EXTRAIDO' }, select: { id: true, emisor: true } });
  for (const r of resumenes) {
    await rematchearResumen(scopedDb(empresa.id), r.id);
    console.log(`re-matcheado ${r.emisor}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
