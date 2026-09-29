import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import type { ScopedDb } from '@/lib/empresa/scope';
import type { Movimiento } from '@prisma/client';
import { DomainError } from '@/lib/errors';
import { enqueueJob } from '@/lib/jobs';
import { writeAudit } from '@/lib/audit';
import { assertTransicion } from '@/lib/movimientos/estados';
import type { TipoDocumento } from '@/lib/carga/no-comprobante';

// Operaciones sobre los documentos apartados como NO_COMPROBANTE (ver
// lib/carga/no-comprobante.ts): marcarlos desde el pipeline y reprocesarlos
// cuando alguien dice "sí, es un comprobante".

export async function marcarNoComprobante(
  db: ScopedDb,
  mov: Movimiento,
  datos: {
    tipoDocumento: TipoDocumento;
    motivo: string | null;
    por: 'PREFILTRO' | 'EXTRACCION';
    uso?: { entrada: number; salida: number; modelo: string } | null;
    extraccionRaw?: unknown;
  },
): Promise<void> {
  assertTransicion(mov.estado, 'NO_COMPROBANTE');
  const flags = {
    ...((mov.flags as object | null) ?? {}),
    tipoDocumento: datos.tipoDocumento,
    motivoNoComprobante: datos.motivo,
    noComprobantePor: datos.por,
    noComprobanteDesde: new Date().toISOString(),
  };
  await db.movimiento.update({
    where: { id: mov.id },
    data: {
      estado: 'NO_COMPROBANTE',
      flags: flags as never,
      ...(datos.uso ? { tokensEntrada: datos.uso.entrada, tokensSalida: datos.uso.salida, modeloExtractor: datos.uso.modelo } : {}),
      ...(datos.extraccionRaw ? { extraccionRaw: datos.extraccionRaw as never } : {}),
    },
  });
  await writeAudit(db, {
    entidad: 'Movimiento',
    entidadId: mov.id,
    accion: 'NO_COMPROBANTE',
    antes: { estado: mov.estado },
    despues: { estado: 'NO_COMPROBANTE', tipoDocumento: datos.tipoDocumento, motivo: datos.motivo, por: datos.por },
  });
}

/** "Sí es un comprobante": vuelve a extraerlo sin prefiltro e ignorando la clasificación. */
export async function reprocesarComoComprobante(ctx: EmpresaContext, id: string): Promise<void> {
  const mov = await ctx.db.movimiento.findFirst({ where: { id } });
  if (!mov) throw new DomainError('Comprobante inexistente.');
  if (mov.estado !== 'NO_COMPROBANTE') throw new DomainError('Sólo se puede reprocesar un documento marcado como "no es comprobante".');
  assertTransicion(mov.estado, 'PROCESANDO');
  const flags = { ...((mov.flags as object | null) ?? {}), forzarComprobante: true };
  await ctx.db.movimiento.update({ where: { id }, data: { estado: 'PROCESANDO', flags: flags as never } });
  await enqueueJob('EXTRACCION', { movimientoId: id, empresaId: ctx.empresa.id }, ctx.empresa.id);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Movimiento',
    entidadId: id,
    accion: 'REPROCESAR_COMO_COMPROBANTE',
    antes: { estado: mov.estado, tipoDocumento: (mov.flags as { tipoDocumento?: string } | null)?.tipoDocumento ?? null },
    despues: { estado: 'PROCESANDO' },
  });
}
