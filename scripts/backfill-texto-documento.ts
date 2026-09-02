import { prisma } from '@/lib/db';
import { getFileStorage } from '@/lib/storage';
import { extraerTextoPdf } from '@/lib/extractor/texto';

// Backfill de extraccionRaw.textoDocumento para comprobantes ya extraídos:
// saca la capa de texto de los PDFs almacenados (unpdf, sin LLM) y la guarda,
// así las reglas por palabra clave matchean también contra lo que figura en el
// papel (emails, referencias) en comprobantes anteriores al campo.
//
// Uso: npx tsx scripts/backfill-texto-documento.ts [--aplicar]
// Sin --aplicar es dry-run: lista qué actualizaría.

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const movimientos = await prisma.movimiento.findMany({
    where: {
      archivoMime: 'application/pdf',
      archivoKey: { not: null },
      extraccionRaw: { not: { equals: null } } as never,
    },
    select: { id: true, empresaId: true, archivoKey: true, archivoNombre: true, extraccionRaw: true },
    orderBy: { createdAt: 'asc' },
  });

  const storage = getFileStorage();
  let conTexto = 0;
  let sinCapa = 0;
  let yaTenian = 0;
  for (const mov of movimientos) {
    const raw = (mov.extraccionRaw as Record<string, unknown> | null) ?? {};
    if (typeof raw.textoDocumento === 'string' && raw.textoDocumento) {
      yaTenian++;
      continue;
    }
    let texto: string | null = null;
    try {
      texto = await extraerTextoPdf(await storage.get(mov.archivoKey!));
    } catch {
      texto = null; // archivo ilegible/ausente: se saltea
    }
    if (!texto) {
      sinCapa++;
      continue;
    }
    conTexto++;
    console.log(`${aplicar ? 'ACTUALIZA' : 'dry-run'} ${mov.id} (${mov.archivoNombre}) — ${texto.length} caracteres`);
    if (aplicar) {
      await prisma.movimiento.update({
        where: { id: mov.id },
        data: { extraccionRaw: { ...raw, textoDocumento: texto } as never },
      });
    }
  }

  console.log(`\nTotal PDFs con extracción: ${movimientos.length}`);
  console.log(`Con capa de texto ${aplicar ? 'actualizados' : 'a actualizar'}: ${conTexto}`);
  console.log(`Sin capa de texto (escaneos): ${sinCapa} · Ya tenían textoDocumento: ${yaTenian}`);
  if (!aplicar) console.log('\nDry-run: corré con --aplicar para escribir.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
