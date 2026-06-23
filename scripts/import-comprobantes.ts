// Import masivo de comprobantes reales por el MISMO pipeline que la web.
// Uso: npx tsx scripts/import-comprobantes.ts <slugEmpresa> [carpeta]
// Por defecto la carpeta es Docs/ComprobantesEjemplos. Idempotente: el pipeline
// deduplica por hash de archivo, así que reejecutar no duplica movimientos.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../lib/db';
import { ingestarComprobante, resolverCreadorCanal } from '../lib/pipeline';
import { claimNextJob, completeJob, failJob } from '../lib/jobs';
import { procesarExtraccion, procesarArca, marcarErrorProcesamiento } from '../lib/pipeline';

async function drenarCola() {
  // Procesa la cola de jobs hasta vaciarla (extracción + ARCA), en línea.
  for (;;) {
    const job = await claimNextJob();
    if (!job) break;
    const payload = job.payload as never as { movimientoId: string; empresaId: string };
    try {
      if (job.tipo === 'EXTRACCION') await procesarExtraccion(payload);
      else if (job.tipo === 'ARCA') await procesarArca(payload);
      await completeJob(job.id);
    } catch (err) {
      const { final } = await failJob(job, err);
      console.error(`  job ${job.tipo} falló (intento ${job.intentos}):`, err instanceof Error ? err.message : err);
      if (final && job.tipo === 'EXTRACCION') {
        await marcarErrorProcesamiento(payload, err instanceof Error ? err.message : String(err));
      }
    }
  }
}

async function main() {
  const slug = process.argv[2];
  const carpeta = process.argv[3] ?? 'Docs/ComprobantesEjemplos';
  if (!slug) {
    console.error('Uso: npx tsx scripts/import-comprobantes.ts <slugEmpresa> [carpeta]');
    process.exit(1);
  }

  const empresa = await prisma.empresa.findUnique({ where: { slug } });
  if (!empresa) {
    console.error(`No existe la empresa con slug "${slug}". Corré el seed primero.`);
    process.exit(1);
  }
  const creadorId = await resolverCreadorCanal(empresa.id, null);
  if (!creadorId) {
    console.error('La empresa no tiene administrador para registrar como creador.');
    process.exit(1);
  }

  const files = (await readdir(carpeta)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  console.log(`Importando ${files.length} PDFs a "${slug}" desde ${carpeta} ...`);

  let ingestados = 0;
  for (const f of files) {
    try {
      const buffer = await readFile(join(carpeta, f));
      await ingestarComprobante({
        empresaId: empresa.id,
        usuarioId: creadorId,
        buffer,
        filename: f,
        mime: 'application/pdf',
        canal: 'WEB',
      });
      ingestados++;
    } catch (err) {
      console.error(`  no se pudo ingestar ${f}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Ingestados ${ingestados}/${files.length}. Procesando la cola...`);

  await drenarCola();

  // Resumen
  const porEstado = await prisma.movimiento.groupBy({
    by: ['estado'],
    where: { empresaId: empresa.id },
    _count: true,
  });
  const porOrigen = await prisma.movimiento.groupBy({
    by: ['origen'],
    where: { empresaId: empresa.id },
    _count: true,
  });
  console.log('Por estado:', Object.fromEntries(porEstado.map((r) => [r.estado, r._count])));
  console.log('Por origen:', Object.fromEntries(porOrigen.map((r) => [r.origen, r._count])));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
