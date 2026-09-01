/**
 * Recalcula aportes/contribuciones de obra social de TODOS los registros de
 * PrepagaEmpleado con el criterio nuevo: los recibos del PERÍODO ANTERIOR
 * (mensual + SAC + vacaciones + liq. final), que son los que se transfieren a
 * la prepaga en el mes del registro y netean esa factura.
 *
 * NO toca costoPlan, prepaga ni fsrPct. Los registros de empleados SIN recibos
 * del período anterior quedan como están (se listan, no se pisan con 0).
 * ⚠ Con --confirm pisa también valores cargados/corregidos a mano.
 *
 * Uso:  npx tsx scripts/recalcular-aportes-prepaga.ts <slug>            (simulación)
 *       npx tsx scripts/recalcular-aportes-prepaga.ts <slug> --confirm  (aplica)
 */
import { prisma } from '../lib/db';
import { scopedDb } from '../lib/empresa/scope';
import { periodoAnterior, MES_LABEL } from '../lib/periodos';
import { aportesObraSocialDeRecibos, type ConceptoRecibo } from '../lib/empleados/prepaga';

const slug = process.argv[2];
const confirmar = process.argv.includes('--confirm');

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  if (!slug) throw new Error('Falta el slug de la empresa');
  const empresa = await prisma.empresa.findFirst({ where: { slug } });
  if (!empresa) throw new Error(`No existe la empresa ${slug}`);
  const db = scopedDb(empresa.id);

  const registros = await db.prepagaEmpleado.findMany({
    include: { periodo: true, empleado: { select: { nombre: true } } },
    orderBy: [{ empleadoId: 'asc' }, { periodo: { anio: 'asc' } }, { periodo: { mes: 'asc' } }],
  });

  const aActualizar: { id: string; aportes: number; contribuciones: number; linea: string }[] = [];
  const sinRecibos: string[] = [];
  let sinCambios = 0;

  for (const r of registros) {
    const prev = periodoAnterior(r.periodo.anio, r.periodo.mes);
    const etiqueta = `${r.empleado.nombre} · ${MES_LABEL[r.periodo.mes]} ${r.periodo.anio} (recibos de ${MES_LABEL[prev.mes]} ${prev.anio})`;

    const recibos = await db.reciboSueldo.findMany({
      where: {
        empleadoId: r.empleadoId,
        estado: { in: ['CONFIRMADO', 'PENDIENTE_REVISION'] },
        periodo: { anio: prev.anio, mes: prev.mes },
      },
    });
    if (recibos.length === 0) {
      sinRecibos.push(etiqueta);
      continue;
    }

    const os = aportesObraSocialDeRecibos(recibos.map((rec) => rec.conceptos as ConceptoRecibo[] | null));
    const igual = os.aportes.toFixed(2) === Number(r.aportes).toFixed(2) && os.contribuciones.toFixed(2) === Number(r.contribuciones).toFixed(2);
    if (igual) {
      sinCambios++;
      continue;
    }

    aActualizar.push({
      id: r.id,
      aportes: os.aportes,
      contribuciones: os.contribuciones,
      linea:
        `  ${etiqueta}\n` +
        `    aportes:        ${fmt(Number(r.aportes))} → ${fmt(os.aportes)}\n` +
        `    contribuciones: ${fmt(Number(r.contribuciones))} → ${fmt(os.contribuciones)}`,
    });
  }

  console.log(`\nEmpresa ${slug}: ${registros.length} registros de prepaga.`);
  console.log(`  ${aActualizar.length} a actualizar · ${sinCambios} ya coinciden · ${sinRecibos.length} sin recibos del período anterior (quedan como están).\n`);
  for (const a of aActualizar) console.log(a.linea);
  if (sinRecibos.length) {
    console.log('\nSin recibos del período anterior (revisar a mano):');
    for (const s of sinRecibos) console.log(`  ${s}`);
  }

  if (!confirmar) {
    console.log('\nSimulación. Repetí con --confirm para aplicar.\n');
    return;
  }

  for (const a of aActualizar) {
    await db.prepagaEmpleado.update({
      where: { id: a.id },
      data: { aportes: a.aportes, contribuciones: a.contribuciones },
    });
  }
  console.log(`\n${aActualizar.length} registros actualizados.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
