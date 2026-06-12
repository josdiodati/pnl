// Duplicate detection: another non-voided movement of the same company with
// identical cuitEmisor + tipoComprobante + puntoVenta + numero.
// It raises a prominent alert but never blocks (per spec).

export type ClaveComprobante = {
  cuitEmisor?: string | null;
  tipoComprobante?: string | null;
  puntoVenta?: string | null;
  numero?: string | null;
};

/** Pure comparison used by the query layer and by tests. */
export function esMismaClave(a: ClaveComprobante, b: ClaveComprobante): boolean {
  const norm = (v: string | null | undefined) => (v ?? '').replace(/^0+/, '').trim().toUpperCase();
  if (!a.cuitEmisor || !a.tipoComprobante || !a.numero) return false;
  return (
    norm(a.cuitEmisor) === norm(b.cuitEmisor) &&
    norm(a.tipoComprobante) === norm(b.tipoComprobante) &&
    norm(a.puntoVenta) === norm(b.puntoVenta) &&
    norm(a.numero) === norm(b.numero)
  );
}

/**
 * Finds candidate duplicates inside the active company. `db` must be the
 * empresa-scoped client, so the search can never cross companies.
 */
export async function buscarDuplicados(
  db: { movimiento: { findMany: (args: any) => Promise<any[]> } },
  clave: ClaveComprobante,
  excluirId?: string,
): Promise<{ id: string; estado: string }[]> {
  if (!clave.cuitEmisor || !clave.tipoComprobante || !clave.numero) return [];
  const candidatos = await db.movimiento.findMany({
    where: {
      cuitEmisor: { not: null },
      numero: { not: null },
      estado: { not: 'ANULADO' },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true, estado: true, cuitEmisor: true, tipoComprobante: true, puntoVenta: true, numero: true },
  });
  return candidatos
    .filter((m) => esMismaClave(clave, m))
    .map((m) => ({ id: m.id, estado: m.estado }));
}
