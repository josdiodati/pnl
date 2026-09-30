import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { distribucionUltimoRecibo, distribucionVigente, mismaDistribucion } from '@/lib/empleados/asignacion';
import { confirmarRecibo } from '@/lib/empleados/service';

// Puesta en marcha de la asignación permanente (lib/empleados/asignacion.ts):
// 1. a cada empleado con la ficha vacía le copia la distribución de su último
//    recibo confirmado;
// 2. confirma los recibos pendientes cuyo ÚNICO motivo era no tener
//    distribución (sin campos a revisar, sin nota, período abierto).
// Los que difieren de la ficha sólo se listan, no se pisan. Idempotente.
//
// Uso: npx tsx scripts/asignacion-permanente.ts --empresa <slug> --usuario <email> [--aplicar]

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
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  const ctx = {
    empresa,
    usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
    rol: 'ADMINISTRADOR',
    db: scopedDb(empresa.id),
  } as EmpresaContext;

  const empleados = await prisma.empleado.findMany({
    where: { empresaId: empresa.id },
    include: { distribucion: true },
    orderBy: { nombre: 'asc' },
  });
  let fichas = 0;
  for (const e of empleados) {
    const ultimo = await distribucionUltimoRecibo(e.id);
    if (!ultimo.length) continue;
    if (e.distribucion.length) {
      const ficha = e.distribucion.map((l) => ({ ...l, porcentaje: Number(l.porcentaje) }));
      if (!mismaDistribucion(ficha, ultimo)) console.log(`≠ ${e.nombre}: la ficha difiere del último recibo (no se toca)`);
      continue;
    }
    fichas++;
    console.log(`ficha ← último recibo: ${e.nombre} (${ultimo.length} línea${ultimo.length !== 1 ? 's' : ''})`);
    if (aplicar) await distribucionVigente(e.id);
  }

  const pendientes = await prisma.reciboSueldo.findMany({
    where: { empresaId: empresa.id, estado: 'PENDIENTE_REVISION', nota: null, periodo: { estado: 'ABIERTO' } },
    include: { empleado: true, periodo: true },
  });
  let confirmados = 0;
  for (const r of pendientes) {
    const campos = (r.camposRevisar as Record<string, string> | null) ?? {};
    const etiqueta = `${r.empleado.nombre} ${r.periodo.anio}-${String(r.periodo.mes).padStart(2, '0')} ${r.tipo}`;
    if (Object.keys(campos).length) {
      console.log(`queda pendiente: ${etiqueta} — ${Object.values(campos).join(' · ')}`);
      continue;
    }
    if (!aplicar) {
      console.log(`se confirmaría: ${etiqueta}`);
      confirmados++;
      continue;
    }
    try {
      await confirmarRecibo(ctx, r.id, {});
      console.log(`confirmado: ${etiqueta}`);
      confirmados++;
    } catch (err) {
      console.log(`NO se pudo confirmar ${etiqueta}: ${(err as Error).message}`);
    }
  }
  console.log(`\n${aplicar ? 'Aplicado' : 'Simulación (usar --aplicar)'}: ${fichas} fichas completadas, ${confirmados} recibos confirmados.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
