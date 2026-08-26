import { cuitContraparteDe } from '@/lib/movimientos/nombre-contraparte';
/**
 * Evalúa las reglas YA existentes de la empresa contra un comprobante existente.
 * No crea ni modifica nada. Muestra, por cada regla, si matchea; cuál gana
 * (elegirRegla); la asignación que resuelve la ganadora; la autovalidación; y el
 * estado final que tendría el comprobante si ingresara hoy.
 *
 *   npx tsx scripts/probar-reglas.ts <comprobanteId>
 */
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { reglaMatchea, elegirRegla, type EntradaRegla } from '@/lib/reglas/matching';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { evaluarAutovalidacion, decidirAutovalidacion } from '@/lib/autovalidacion';
import { tieneAsignacionCompleta } from '@/lib/movimientos/service';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('Falta el id del comprobante');

  const mov = await prisma.movimiento.findUnique({ where: { id } });
  if (!mov) throw new Error(`Comprobante ${id} inexistente`);
  const db = scopedDb(mov.empresaId);

  const extr = (mov.extraccionRaw as Record<string, unknown> | null) ?? {};
  const razonSocial = (extr.razonSocialEmisor as string) ?? '';
  const dups = (mov.flags as { duplicados?: string[] } | null)?.duplicados ?? [];

  const entrada: EntradaRegla = {
    creadoPorId: mov.creadoPorId,
    cuitContraparte: cuitContraparteDe(mov),
    canalIngreso: mov.canalIngreso,
    texto: `${razonSocial} ${mov.descripcion ?? ''}`,
  };

  console.log('=== Comprobante ===');
  console.log({ id: mov.id, estado: mov.estado, canal: mov.canalIngreso, cuitContraparte: cuitContraparteDe(mov),
    razonSocialEmisor: razonSocial, creadoPorId: mov.creadoPorId, qrEstado: mov.qrEstado });
  console.log('Entrada para matching:', entrada);

  const reglas = await db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }, { nombre: 'asc' }] });
  console.log(`\n=== Reglas de la empresa (${reglas.length}) ===`);
  for (const r of reglas) {
    console.log({
      nombre: r.nombre, prioridad: r.prioridad, activa: r.activa,
      condiciones: { cargadoPorId: r.cargadoPorId, cuit: r.cuit, canal: r.canal, palabraClave: r.palabraClave },
      accion: { categoriaId: r.categoriaId, distribucionId: r.distribucionId, centroCostoId: r.centroCostoId, clienteId: r.clienteId, proyectoId: r.proyectoId },
      matchea: r.activa && reglaMatchea(r, entrada),
    });
  }

  const elegida = elegirRegla(reglas, entrada);
  console.log('\n=== Regla elegida (mayor prioridad entre las que matchean) ===');
  console.log(elegida ? elegida.nombre : 'ninguna');

  const auto = evaluarAutovalidacion({
    qrEstado: mov.qrEstado,
    esComprobanteFiscalArg: !!extr.esComprobanteFiscalArg,
    cae: mov.cae,
    qrAporto: extr.qrAfip != null,
    importes: {
      netoGravado: mov.netoGravado != null ? Number(mov.netoGravado) : null,
      iva21: mov.iva21 != null ? Number(mov.iva21) : null,
      iva105: mov.iva105 != null ? Number(mov.iva105) : null,
      iva27: mov.iva27 != null ? Number(mov.iva27) : null,
      percepcionesIva: mov.percepcionesIva != null ? Number(mov.percepcionesIva) : null,
      percepcionesIibb: mov.percepcionesIibb != null ? Number(mov.percepcionesIibb) : null,
      otrosTributos: mov.otrosTributos != null ? Number(mov.otrosTributos) : null,
      noGravadoExento: mov.noGravadoExento != null ? Number(mov.noGravadoExento) : null,
    },
    total: mov.total != null ? Number(mov.total) : null,
    hayDuplicados: dups.length > 0,
  });

  let completa = false;
  if (elegida) {
    const asign = await resolverAsignacionDeRegla(db, elegida);
    completa = tieneAsignacionCompleta(asign.categoriaId, asign.lineas);
    console.log('\n=== Asignación que resuelve la regla elegida ===');
    console.log({ categoriaId: asign.categoriaId, lineas: asign.lineas, asignacionCompleta: completa });
  }

  const estadoFinal = decidirAutovalidacion({ apto: auto.apto, completa, estadoBase: 'PENDIENTE_VALIDACION' });
  console.log('\n=== RESULTADO si ingresara hoy ===');
  console.log({
    autovalidacion_apta: auto.apto, motivos: auto.motivos,
    regla_matchea: !!elegida, asignacion_completa: completa, estado_final: estadoFinal,
  });

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
