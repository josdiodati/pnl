import type { ScopedDb } from '@/lib/empresa/scope';

// Every relevant change goes through the service layer, which records an
// AuditLog entry with before/after snapshots. The scoped client forces
// empresaId, so audit entries can never land on another company.

export type AuditEntrada = {
  usuarioId?: string | null;
  entidad: string; // 'Movimiento' | 'Categoria' | 'Periodo' | ...
  entidadId: string;
  accion: string; // 'CREAR' | 'EDITAR' | 'VALIDAR' | 'OBSERVAR' | 'ANULAR' | 'CERRAR' | 'REABRIR' | ...
  antes?: unknown;
  despues?: unknown;
};

function serializable(v: unknown): any {
  if (v === undefined) return undefined;
  // Decimal/Date safe JSON snapshot
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val)));
}

export async function writeAudit(db: ScopedDb, entrada: AuditEntrada): Promise<void> {
  await db.auditLog.create({
    data: {
      usuarioId: entrada.usuarioId ?? null,
      entidad: entrada.entidad,
      entidadId: entrada.entidadId,
      accion: entrada.accion,
      antes: serializable(entrada.antes) ?? undefined,
      despues: serializable(entrada.despues) ?? undefined,
    } as never,
  });
}
