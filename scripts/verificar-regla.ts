/**
 * Verifica el motor de reglas + autovalidación contra un comprobante YA existente
 * (sin subir nada nuevo). Crea una regla que lo matchea por su CUIT (o canal),
 * corre matching + resolución + autovalidación, imprime el resultado y borra la
 * regla de prueba al final.
 *
 *   npx tsx scripts/verificar-regla.ts <comprobanteId>
 */
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { elegirRegla } from '@/lib/reglas/matching';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { evaluarAutovalidacion, decidirAutovalidacion } from '@/lib/autovalidacion';
import { tieneAsignacionCompleta } from '@/lib/movimientos/service';

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('Falta el id del comprobante');

  const mov = await prisma.movimiento.findUnique({ where: { id }, include: { contraparte: true } });
  if (!mov) throw new Error(`Comprobante ${id} inexistente`);
  const db = scopedDb(mov.empresaId);

  const extr = (mov.extraccionRaw as Record<string, unknown> | null) ?? {};
  const razonSocial = (extr.razonSocialEmisor as string) ?? '';
  const dups = ((mov.flags as { duplicados?: string[] } | null)?.duplicados ?? []);

  console.log('=== Comprobante ===');
  console.log({
    id: mov.id, estado: mov.estado, canal: mov.canalIngreso, creadoPorId: mov.creadoPorId,
    cuitEmisor: mov.cuitEmisor, razonSocialEmisor: razonSocial, descripcion: mov.descripcion,
    qrEstado: mov.qrEstado, cae: mov.cae, total: mov.total?.toString() ?? null,
    esComprobanteFiscalArg: extr.esComprobanteFiscalArg, qrAfip: extr.qrAfip ? 'presente' : 'ausente',
    duplicados: dups.length,
  });

  // 1) Autovalidación (chequeos determinísticos), reconstruida desde lo guardado
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
  console.log('\n=== Autovalidación ===');
  console.log({ apto: auto.apto, motivos: auto.motivos });

  // 2) Crear una regla de prueba que matchee este comprobante
  const categoria = await db.categoria.findFirst({ where: { activa: true }, orderBy: { nombre: 'asc' } });
  const centro = await db.centroCosto.findFirst({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  if (!categoria || !centro) throw new Error('La empresa necesita al menos una categoría y un centro activos.');

  const condicion = mov.cuitEmisor
    ? { cuit: mov.cuitEmisor }
    : mov.canalIngreso
      ? { canal: mov.canalIngreso }
      : { palabraClave: razonSocial.split(' ')[0] || 'comprobante' };

  const regla = await db.reglaAsignacion.create({
    data: {
      nombre: `__TEST__ ${id.slice(-6)}`,
      prioridad: 1,
      ...condicion,
      categoriaId: categoria.id,
      centroCostoId: centro.id,
    } as never,
  });
  console.log('\n=== Regla de prueba creada ===');
  console.log({ nombre: regla.nombre, condicion, accion: { categoria: categoria.nombre, centro: centro.nombre } });

  try {
    // 3) Matching + resolución (lo que haría el pipeline / la cola de Asignación)
    const reglas = await db.reglaAsignacion.findMany({ orderBy: [{ prioridad: 'asc' }] });
    const elegida = elegirRegla(reglas, {
      creadoPorId: mov.creadoPorId,
      cuitEmisor: mov.cuitEmisor,
      canalIngreso: mov.canalIngreso,
      texto: `${razonSocial} ${mov.descripcion ?? ''}`,
    });
    console.log('\n=== Matching ===');
    console.log({ reglaElegida: elegida?.nombre ?? null, matcheaLaDePrueba: elegida?.id === regla.id });

    let estadoFinal = 'PENDIENTE_VALIDACION';
    let completa = false;
    if (elegida) {
      const asign = await resolverAsignacionDeRegla(db, elegida);
      completa = tieneAsignacionCompleta(asign.categoriaId, asign.lineas);
      estadoFinal = decidirAutovalidacion({ apto: auto.apto, completa, estadoBase: 'PENDIENTE_VALIDACION' });
      console.log('\n=== Resolución de la regla ===');
      console.log({ categoriaId: asign.categoriaId, lineas: asign.lineas, asignacionCompleta: completa });
    }

    console.log('\n=== RESULTADO (qué pasaría al ingresar este comprobante hoy) ===');
    console.log({
      apto_autovalidacion: auto.apto,
      regla_matchea: !!elegida,
      asignacion_completa: completa,
      estado_final: estadoFinal,
      interpretacion:
        estadoFinal === 'ASIGNADO' ? 'Se auto-asignaría (salta validación y asignación manual).'
          : estadoFinal === 'VALIDADO' ? 'Se auto-validaría; iría a la cola de Asignación (pre-llenada por la regla).'
            : 'Quedaría en validación manual (no apto para autovalidación).',
    });
  } finally {
    await db.reglaAsignacion.delete({ where: { id: regla.id } });
    console.log(`\n(regla de prueba "${regla.nombre}" eliminada)`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
