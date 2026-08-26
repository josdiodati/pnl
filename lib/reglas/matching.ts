import type { ReglaAsignacion } from '@prisma/client';
import { normalizarCuit } from '@/lib/checks';

// Matching puro de reglas de preasignación. Semántica AND entre las condiciones
// seteadas; una regla SIN ninguna condición no matchea nunca (evita reglas
// atrapa-todo accidentales).

export type EntradaRegla = {
  creadoPorId: string | null;
  /** CUIT de la CONTRAPARTE: el emisor en compras, el RECEPTOR en ventas
   *  (en una venta el emisor es siempre la propia empresa y no discrimina). */
  cuitContraparte: string | null; // normalizado o crudo
  canalIngreso: string | null;
  texto: string; // descripción + razón social de la contraparte, en minúsculas
};

export function reglaMatchea(regla: ReglaAsignacion, e: EntradaRegla): boolean {
  const cond = [regla.cargadoPorId, regla.cuit, regla.canal, regla.palabraClave];
  if (cond.every((c) => c == null || c === '')) return false; // sin condiciones: no matchea
  if (regla.cargadoPorId && regla.cargadoPorId !== e.creadoPorId) return false;
  if (regla.cuit && normalizarCuit(regla.cuit) !== (e.cuitContraparte ? normalizarCuit(e.cuitContraparte) : null)) return false;
  if (regla.canal && regla.canal !== e.canalIngreso) return false;
  if (regla.palabraClave && !e.texto.toLowerCase().includes(regla.palabraClave.toLowerCase())) return false;
  return true;
}

export function elegirRegla(reglas: ReglaAsignacion[], e: EntradaRegla): ReglaAsignacion | null {
  const candidatas = reglas
    .filter((r) => r.activa && reglaMatchea(r, e))
    .sort((a, b) => a.prioridad - b.prioridad || a.createdAt.getTime() - b.createdAt.getTime());
  return candidatas[0] ?? null;
}
