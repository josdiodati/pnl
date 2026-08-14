/**
 * Devuelve a PENDIENTE_VALIDACION los comprobantes que llegaron al libro por
 * autovalidación del sistema (AUTO_VALIDAR) y que nadie tocó después.
 *
 * NO toca:
 *   - los que validó o asignó una persona (acciones VALIDAR / ASIGNAR)
 *   - los que asignó una regla (AUTO_ASIGNAR)
 *
 * Uso:  npx tsx scripts/devolver-autovalidados.ts <slug>            (simulación)
 *       npx tsx scripts/devolver-autovalidados.ts <slug> --confirm  (aplica)
 */
import { prisma } from '../lib/db';
import { scopedDb } from '../lib/empresa/scope';
import { assertTransicion } from '../lib/movimientos/estados';
import { writeAudit } from '../lib/audit';

const slug = process.argv[2];
const confirmar = process.argv.includes('--confirm');

async function main() {
  if (!slug) throw new Error('Falta el slug de la empresa');
  const empresa = await prisma.empresa.findFirst({ where: { slug } });
  if (!empresa) throw new Error(`No existe la empresa ${slug}`);
  const db = scopedDb(empresa.id);

  const enLibro = await db.movimiento.findMany({
    where: { estado: { in: ['VALIDADO', 'ASIGNADO'] } },
    orderBy: { createdAt: 'asc' },
  });

  const candidatos: typeof enLibro = [];
  for (const mov of enLibro) {
    const acciones = (
      await db.auditLog.findMany({
        where: { entidad: 'Movimiento', entidadId: mov.id },
        select: { accion: true },
      })
    ).map((a) => a.accion);

    const intervinoUnaPersona = acciones.includes('VALIDAR') || acciones.includes('ASIGNAR');
    const intervinoUnaRegla = acciones.includes('AUTO_ASIGNAR');
    const loValidoElSistema = acciones.includes('AUTO_VALIDAR');

    if (loValidoElSistema && !intervinoUnaPersona && !intervinoUnaRegla) candidatos.push(mov);
  }

  console.log(`\nEmpresa ${slug}: ${enLibro.length} en el libro, ${candidatos.length} a devolver.\n`);
  for (const m of candidatos) {
    console.log(
      `  ${m.estado.padEnd(9)} ${(m.tipoComprobante ?? '?').padEnd(15)} ${(m.cuitEmisor ?? '?').padEnd(12)} ${String(m.total ?? '')}`,
    );
  }

  if (!confirmar) {
    console.log('\nSimulación. Repetí con --confirm para aplicar.\n');
    return;
  }

  let devueltos = 0;
  for (const mov of candidatos) {
    assertTransicion(mov.estado, 'PENDIENTE_VALIDACION');
    await db.movimiento.update({
      where: { id: mov.id },
      data: { estado: 'PENDIENTE_VALIDACION', validadoPorId: null },
    });
    await writeAudit(db, {
      entidad: 'Movimiento',
      entidadId: mov.id,
      accion: 'VOLVER_A_PENDIENTE',
      antes: { estado: mov.estado },
      despues: {
        estado: 'PENDIENTE_VALIDACION',
        motivo: 'devuelto a revisión: autovalidado por el sistema, sin intervención humana ni de reglas',
      },
    });
    devueltos++;
  }
  console.log(`\n${devueltos} comprobantes devueltos a PENDIENTE_VALIDACION.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
