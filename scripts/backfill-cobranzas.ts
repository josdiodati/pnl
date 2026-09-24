import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { textoDocumentoDe } from '@/lib/reglas/matching';
import { vencimientoPagoDesdeTexto } from '@/lib/cobranzas/vencimiento';
import { sincronizarCobrosDeLinea } from '@/lib/cobranzas/conciliacion';
import { ORIGENES_VENTA } from '@/lib/ventas/query';

// Backfill de Spec F (cobranzas), idempotente:
//  1. fechaVencimientoPago de las ventas existentes, leída del texto ya
//     guardado del documento (sin LLM).
//  2. Cobros de las líneas de banco YA conciliadas contra ventas: se corre la
//     misma sincronización que al conciliar (retención ≤5%, ajuste de cambio en
//     USD). Las líneas que ya tienen cobros no se tocan.
//
// Uso: npx tsx scripts/backfill-cobranzas.ts --usuario <email> [--aplicar]
// Sin --aplicar es dry-run. El usuario queda como autor de los cobros/ajustes.

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const iUsuario = process.argv.indexOf('--usuario');
  const email = iUsuario > 0 ? process.argv[iUsuario + 1] : null;
  if (!email) throw new Error('Indicá --usuario <email> (autor de los cobros y ajustes).');
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });

  // 1. Vencimientos.
  const ventas = await prisma.movimiento.findMany({
    where: { origen: { in: [...ORIGENES_VENTA] }, fechaVencimientoPago: null },
    select: { id: true, numero: true, extraccionRaw: true, empresa: { select: { razonSocial: true } } },
  });
  let conVto = 0;
  for (const v of ventas) {
    const iso = vencimientoPagoDesdeTexto(textoDocumentoDe(v.extraccionRaw));
    if (!iso) continue;
    conVto++;
    console.log(`vto  ${v.empresa.razonSocial} ${v.numero} -> ${iso}`);
    if (aplicar) await prisma.movimiento.update({ where: { id: v.id }, data: { fechaVencimientoPago: new Date(`${iso}T00:00:00Z`) } });
  }
  console.log(`Vencimientos: ${conVto} de ${ventas.length} ventas sin vencimiento.`);

  // 2. Cobros desde líneas conciliadas.
  const lineas = await prisma.resumenLinea.findMany({
    where: {
      estado: 'CONCILIADA',
      monto: { gt: 0 },
      cobros: { none: {} },
      vinculos: { some: { movimiento: { origen: { in: [...ORIGENES_VENTA] } } } },
    },
    include: { resumen: { include: { empresa: true } }, vinculos: { include: { movimiento: { select: { numero: true } } } } },
    orderBy: { fecha: 'asc' },
  });
  for (const l of lineas) {
    const empresa = l.resumen.empresa;
    console.log(`cobro ${empresa.razonSocial} ${l.fecha?.toISOString().slice(0, 10)} ${Number(l.monto)} «${l.descriptor.slice(0, 50)}» -> ventas ${l.vinculos.map((v) => v.movimiento.numero).join(', ')}`);
    if (!aplicar) continue;
    const membresia = await prisma.usuarioEmpresa.findFirst({ where: { usuarioId: usuario.id, empresaId: empresa.id } });
    const ctx = {
      empresa,
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      rol: membresia?.rol ?? 'ADMINISTRADOR',
      db: scopedDb(empresa.id),
    } as EmpresaContext;
    await sincronizarCobrosDeLinea(ctx, l.id);
  }
  console.log(`Líneas conciliadas contra ventas sin cobros: ${lineas.length}.${aplicar ? ' Sincronizadas.' : ' (dry-run: usá --aplicar)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
