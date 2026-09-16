import { prisma } from '@/lib/db';
import { getFileStorage } from '@/lib/storage';
import { verificarTitular } from '@/lib/resumenes/titular';

// Recalcula la verificación de titular de los resúmenes ya extraídos antes de
// que existiera (quedaron SIN_DATOS por defecto): capa de texto del PDF +
// titular declarado en la extracción, si lo hubiera. No toca los CONFIRMADA.
//
//   npx tsx scripts/backfill-verificacion-titular.ts            # sólo muestra
//   npx tsx scripts/backfill-verificacion-titular.ts --aplicar  # escribe

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const resumenes = await prisma.resumen.findMany({
    where: { estado: 'EXTRAIDO', verificacionTitular: { not: 'CONFIRMADA' } },
    include: { empresa: true },
    orderBy: { createdAt: 'asc' },
  });
  const storage = getFileStorage();
  let cambios = 0;
  for (const r of resumenes) {
    let texto: string | null = null;
    try {
      const buffer = await storage.get(r.archivoKey);
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(buffer));
      texto = (await extractText(doc, { mergePages: true })).text as string;
    } catch {
      texto = null;
    }
    const raw = (r.extraccionRaw as { titularCuenta?: string | null; cuitTitularCuenta?: string | null } | null) ?? {};
    const v = verificarTitular({
      texto,
      titularCuenta: raw.titularCuenta ?? null,
      cuitTitularCuenta: raw.cuitTitularCuenta ?? null,
      empresa: { razonSocial: r.empresa.razonSocial, cuit: r.empresa.cuit },
    });
    const cambia = v.resultado !== r.verificacionTitular || (v.titularDetectado ?? null) !== (r.titularDetectado ?? null);
    console.log(`${cambia ? '*' : ' '} ${r.empresa.slug.padEnd(8)} ${r.emisor.slice(0, 60).padEnd(60)} ${r.verificacionTitular} -> ${v.resultado}${v.titularDetectado ? ` (${v.titularDetectado})` : ''}`);
    if (cambia && aplicar) {
      await prisma.resumen.update({ where: { id: r.id }, data: { verificacionTitular: v.resultado, titularDetectado: v.titularDetectado } });
      cambios++;
    }
  }
  console.log(aplicar ? `Actualizados: ${cambios}` : 'Modo consulta (sin --aplicar): nada escrito.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
