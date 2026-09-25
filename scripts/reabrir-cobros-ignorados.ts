import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { deshacerLinea } from '@/lib/resumenes/service';
import { rematchearResumen } from '@/lib/resumenes/ingesta';

// Las líneas de resumen ignoradas con el motivo viejo "Cobros" (antes de que
// existiera "Cobro de facturas…") vuelven a PENDIENTE para conciliarlas contra
// sus facturas. Usa deshacerLinea (queda en la auditoría) y re-matchea cada
// resumen afectado para que aparezcan las sugerencias. Idempotente.
//
// Uso: npx tsx scripts/reabrir-cobros-ignorados.ts --usuario <email> [--aplicar]

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const i = process.argv.indexOf('--usuario');
  const email = i > 0 ? process.argv[i + 1] : null;
  if (!email) throw new Error('Indicá --usuario <email>.');
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  const lineas = await prisma.resumenLinea.findMany({
    where: { estado: 'IGNORADA', motivoIgnorada: 'Cobros' },
    include: { resumen: { include: { empresa: true } } },
    orderBy: { fecha: 'asc' },
  });
  const resumenes = new Map<string, EmpresaContext>();
  for (const l of lineas) {
    console.log(`${l.resumen.empresa.razonSocial} ${l.fecha?.toISOString().slice(0, 10)} ${Number(l.monto)} «${l.descriptor.slice(0, 60)}»`);
    if (!aplicar) continue;
    const ctx = {
      empresa: l.resumen.empresa,
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      rol: 'ADMINISTRADOR',
      db: scopedDb(l.resumen.empresaId),
    } as EmpresaContext;
    await deshacerLinea(ctx, { lineaId: l.id });
    resumenes.set(l.resumenId, ctx);
  }
  for (const [resumenId, ctx] of resumenes) await rematchearResumen(ctx.db, resumenId);
  if (aplicar) {
    const despues = await prisma.resumenLinea.findMany({ where: { id: { in: lineas.map((l) => l.id) } }, select: { estado: true, descriptor: true, candidatos: true } });
    for (const d of despues) {
      const top = ((d.candidatos as { motivo: string }[] | null) ?? [])[0];
      console.log(`  -> ${d.estado} «${d.descriptor.slice(0, 40)}»${top ? ` · ${top.motivo}` : ''}`);
    }
  }
  console.log(`${lineas.length} líneas ignoradas como "Cobros".${aplicar ? ' Reabiertas.' : ' (dry-run: usá --aplicar)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
