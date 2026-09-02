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

/** Texto contra el que matchea la palabra clave de una regla: razón social +
 *  descripción + texto plano del documento. Un solo armado para el pipeline,
 *  las vistas y el pop-up OCR — si divergen, una regla "aplica" distinto según
 *  quién la evalúe. */
export function textoDeMatching(e: {
  razonSocial: string | null | undefined;
  descripcion: string | null | undefined;
  textoDocumento?: string | null;
}): string {
  return [e.razonSocial, e.descripcion, e.textoDocumento]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El texto plano del documento guardado en extraccionRaw (null en
 *  extracciones anteriores al campo). */
export function textoDocumentoDe(extraccionRaw: unknown): string | null {
  if (!extraccionRaw || typeof extraccionRaw !== 'object') return null;
  const t = (extraccionRaw as Record<string, unknown>).textoDocumento;
  return typeof t === 'string' && t ? t : null;
}

export function reglaMatchea(regla: ReglaAsignacion, e: EntradaRegla): boolean {
  const cond = [regla.cargadoPorId, regla.cuit, regla.canal, regla.palabraClave];
  if (cond.every((c) => c == null || c === '')) return false; // sin condiciones: no matchea
  if (regla.cargadoPorId && regla.cargadoPorId !== e.creadoPorId) return false;
  if (regla.cuit && normalizarCuit(regla.cuit) !== (e.cuitContraparte ? normalizarCuit(e.cuitContraparte) : null)) return false;
  if (regla.canal && regla.canal !== e.canalIngreso) return false;
  if (regla.palabraClave && !e.texto.toLowerCase().includes(regla.palabraClave.toLowerCase())) return false;
  return true;
}

export type CondicionRegla = {
  tipo: 'CARGADO_POR' | 'CUIT' | 'CANAL' | 'PALABRA_CLAVE';
  valor: string;
};

/** Condiciones seteadas de una regla, para registrar en el historial POR QUÉ
 *  matcheó (el matching es AND: si la regla aplicó, aplicaron todas). */
export function condicionesDeMatch(regla: ReglaAsignacion): CondicionRegla[] {
  const out: CondicionRegla[] = [];
  if (regla.cargadoPorId) out.push({ tipo: 'CARGADO_POR', valor: regla.cargadoPorId });
  if (regla.cuit) out.push({ tipo: 'CUIT', valor: regla.cuit });
  if (regla.canal) out.push({ tipo: 'CANAL', valor: regla.canal });
  if (regla.palabraClave) out.push({ tipo: 'PALABRA_CLAVE', valor: regla.palabraClave });
  return out;
}

export function elegirRegla(reglas: ReglaAsignacion[], e: EntradaRegla): ReglaAsignacion | null {
  const candidatas = reglas
    .filter((r) => r.activa && reglaMatchea(r, e))
    .sort((a, b) => a.prioridad - b.prioridad || a.createdAt.getTime() - b.createdAt.getTime());
  return candidatas[0] ?? null;
}
