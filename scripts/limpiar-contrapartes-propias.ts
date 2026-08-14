/**
 * Limpia las contrapartes que en realidad son la propia empresa.
 *
 * Las creó el alta automática antes del arreglo: el LLM invertía emisor y
 * receptor, el QR corregía el CUIT pero no el nombre (no lo trae), y quedaba un
 * proveedor con el CUIT de un tercero y el nombre de la empresa.
 *
 * Deja los comprobantes como habrían quedado con el código ya arreglado: sin
 * contraparte y flageados, para que el validador cargue el nombre real. No se
 * inventa ningún nombre.
 *
 * Uso:  npx tsx scripts/limpiar-contrapartes-propias.ts <slug>            (simulación)
 *       npx tsx scripts/limpiar-contrapartes-propias.ts <slug> --confirm  (aplica)
 */
import { prisma } from '../lib/db';
import { scopedDb } from '../lib/empresa/scope';
import { writeAudit } from '../lib/audit';
import { esLaPropiaEmpresa } from '../lib/contrapartes/alta-automatica';

const slug = process.argv[2];
const confirmar = process.argv.includes('--confirm');

const FLAG_NUEVA = 'Contraparte nueva: no está en el maestro';

async function main() {
  if (!slug) throw new Error('Falta el slug de la empresa');
  const empresa = await prisma.empresa.findFirst({ where: { slug } });
  if (!empresa) throw new Error(`No existe la empresa ${slug}`);
  const db = scopedDb(empresa.id);

  const todas = await db.contraparte.findMany();
  const invalidas = todas.filter((c) => esLaPropiaEmpresa(c, empresa));

  console.log(`\nEmpresa ${slug}: ${todas.length} contrapartes, ${invalidas.length} son la propia empresa.\n`);

  for (const c of invalidas) {
    const movs = await db.movimiento.findMany({ where: { contraparteId: c.id } });
    console.log(`  ${c.cuit}  «${c.razonSocial}»  → ${movs.length} comprobante(s) a desvincular`);
    for (const m of movs) console.log(`      ${m.estado.padEnd(21)} ${m.archivoNombre ?? ''}`);

    if (!confirmar) continue;

    for (const m of movs) {
      await db.movimiento.update({
        where: { id: m.id },
        data: {
          contraparteId: null,
          camposRevisar: { ...((m.camposRevisar as object | null) ?? {}), contraparte: FLAG_NUEVA } as never,
        },
      });
      await writeAudit(db, {
        entidad: 'Movimiento',
        entidadId: m.id,
        accion: 'EDITAR',
        antes: { contraparteId: c.id, contraparte: c.razonSocial },
        despues: { contraparteId: null, motivo: 'contraparte inválida: era la propia empresa' },
      });
    }

    await db.contraparte.delete({ where: { id: c.id } });
    await writeAudit(db, {
      entidad: 'Contraparte',
      entidadId: c.id,
      accion: 'ELIMINAR',
      antes: { cuit: c.cuit, razonSocial: c.razonSocial },
      despues: { motivo: 'alta automática inválida: el nombre extraído era el de la propia empresa' },
    });
  }

  console.log(confirmar ? '\nLimpieza aplicada.\n' : '\nSimulación. Repetí con --confirm para aplicar.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
