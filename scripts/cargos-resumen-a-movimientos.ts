import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { MOTIVOS_CARGO, type MotivoCargo } from '@/lib/resumenes/motivos';
import { imputarCargo } from '@/lib/resumenes/service';

// Convierte los "cargos de resúmenes" viejos — líneas IGNORADAS con motivo
// Seguros / Comisiones / Consumo sin comprobante, que computaban en el P&L
// como sección aparte — en movimientos reales (imputarCargo: origen RESUMEN,
// 100% al centro de costo que ya tenían, categoría del motivo).
// - Sin centro de costo: vuelven a PENDIENTE para resolverlas a mano.
// - Sin importe en pesos (consumos USD): quedan como están (tampoco
//   computaban antes); se resuelven con Imputar ingresando el monto.
// El autor del movimiento es quien ignoró la línea (auditoría), o --usuario.
// Idempotente: sólo toca líneas que siguen IGNORADAS con esos motivos.
//
// Uso: npx tsx scripts/cargos-resumen-a-movimientos.ts --empresa <slug> --usuario <email> [--aplicar]

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  return i > 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const slug = arg('--empresa');
  const email = arg('--usuario');
  if (!slug || !email) throw new Error('Indicá --empresa <slug> --usuario <email>.');
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { slug } });
  const porDefecto = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  const db = scopedDb(empresa.id);
  const ctxDe = (usuario: { id: string; email: string; nombre: string }) =>
    ({ empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db }) as EmpresaContext;

  const lineas = await db.resumenLinea.findMany({
    where: { estado: 'IGNORADA', motivoIgnorada: { in: MOTIVOS_CARGO } },
    orderBy: [{ fecha: 'asc' }, { orden: 'asc' }],
  });
  const c = { movimientos: 0, pendientes: 0, sinPesos: 0, errores: 0 };
  let total = 0;
  for (const l of lineas) {
    const etiqueta = `${l.fecha?.toISOString().slice(0, 10) ?? '—'} ${l.descriptor} (${l.motivoIgnorada}, ${l.monto ?? 'sin pesos'})`;
    if (l.monto == null) {
      console.log(`queda ignorada (sin importe en pesos): ${etiqueta}`);
      c.sinPesos++;
      continue;
    }
    if (!l.centroCostoId) {
      console.log(`→ PENDIENTE (sin centro de costo): ${etiqueta}`);
      c.pendientes++;
      if (aplicar) {
        await db.resumenLinea.update({ where: { id: l.id }, data: { estado: 'PENDIENTE', motivoIgnorada: null, reglaAplicada: null } });
      }
      continue;
    }
    if (!aplicar) {
      console.log(`se crearía el movimiento: ${etiqueta}`);
      c.movimientos++;
      total += Number(l.monto);
      continue;
    }
    const audit = await prisma.auditLog.findFirst({
      where: { empresaId: empresa.id, accion: 'RESUMEN_IGNORAR', despues: { path: ['lineaId'], equals: l.id } },
      orderBy: { createdAt: 'desc' },
    });
    const autor = (audit?.usuarioId && (await prisma.usuario.findUnique({ where: { id: audit.usuarioId } }))) || porDefecto;
    // imputarCargo sólo resuelve líneas PENDIENTE/SUGERIDA: se reabre y, si
    // falla, se restaura tal cual estaba.
    await db.resumenLinea.update({ where: { id: l.id }, data: { estado: 'PENDIENTE', motivoIgnorada: null, centroCostoId: null } });
    try {
      await imputarCargo(ctxDe(autor), { lineaId: l.id, motivo: l.motivoIgnorada as MotivoCargo, centroCostoId: l.centroCostoId });
      if (l.reglaAplicada) await db.resumenLinea.update({ where: { id: l.id }, data: { reglaAplicada: l.reglaAplicada } });
      console.log(`movimiento creado: ${etiqueta}`);
      c.movimientos++;
      total += Number(l.monto);
    } catch (err) {
      await db.resumenLinea.update({
        where: { id: l.id },
        data: { estado: 'IGNORADA', motivoIgnorada: l.motivoIgnorada, centroCostoId: l.centroCostoId },
      });
      console.log(`NO se pudo convertir ${etiqueta}: ${(err as Error).message}`);
      c.errores++;
    }
  }
  console.log(
    `\n${aplicar ? 'Aplicado' : 'Simulación (usar --aplicar)'} en ${slug}: ${c.movimientos} movimientos (${total.toFixed(2)}), ` +
      `${c.pendientes} a pendiente (sin centro), ${c.sinPesos} sin pesos sin tocar, ${c.errores} errores.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
