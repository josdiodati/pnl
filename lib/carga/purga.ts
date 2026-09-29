import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { getFileStorage } from '@/lib/storage';
import { writeAudit } from '@/lib/audit';
import { DIAS_RETENCION_NO_COMPROBANTE } from '@/lib/carga/no-comprobante';

// Purga de los documentos apartados como NO_COMPROBANTE: a los 7 días se
// borran el movimiento y el archivo (única excepción, junto con los
// duplicados, al "nada se borra"). Queda auditado con los datos para saber
// qué se borró. La corre el worker una vez por hora.

export async function purgarNoComprobantes(ahora: Date = new Date()): Promise<number> {
  const limite = new Date(ahora.getTime() - DIAS_RETENCION_NO_COMPROBANTE * 86_400_000);
  const vencidos = await prisma.movimiento.findMany({
    where: { estado: 'NO_COMPROBANTE', updatedAt: { lte: limite } },
    select: { id: true, empresaId: true, archivoKey: true, archivoNombre: true, loteId: true, flags: true, canalIngreso: true, createdAt: true },
  });
  const storage = getFileStorage();
  for (const m of vencidos) {
    const db = scopedDb(m.empresaId);
    await db.movimiento.delete({ where: { id: m.id } });
    // El lote esperaba ese archivo: descontarlo (como al borrar un duplicado).
    if (m.loteId) {
      await prisma.loteIngesta.updateMany({ where: { id: m.loteId, archivos: { gt: 0 } }, data: { archivos: { decrement: 1 } } });
    }
    // El archivo sólo se borra si ningún otro movimiento lo usa.
    if (m.archivoKey && !(await prisma.movimiento.count({ where: { archivoKey: m.archivoKey } }))) {
      await storage.remove(m.archivoKey);
    }
    const f = (m.flags as { tipoDocumento?: string; motivoNoComprobante?: string } | null) ?? {};
    await writeAudit(db, {
      entidad: 'Movimiento',
      entidadId: m.id,
      accion: 'PURGAR_NO_COMPROBANTE',
      antes: {
        archivoNombre: m.archivoNombre,
        tipoDocumento: f.tipoDocumento ?? null,
        motivo: f.motivoNoComprobante ?? null,
        canal: m.canalIngreso,
        cargado: m.createdAt.toISOString(),
      },
    });
  }
  if (vencidos.length) console.log(`[purga] ${vencidos.length} documento(s) que no eran comprobantes borrado(s)`);
  return vencidos.length;
}
