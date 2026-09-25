import { normalizarDescriptor, similitudTexto, cobroPosibleEnFecha } from '@/lib/resumenes/matching';
import { UMBRAL_RETENCION } from './reparto';

// Sugerencias para "Cobro de facturas…" en la bandeja del resumen: qué cliente
// es (por CUIT en el descriptor, descriptores aprendidos o nombre) y qué
// combinación de sus facturas pendientes (1 a 3) explica el crédito, exacto o
// neto de retenciones. Puro.

export type ClienteSugerible = { id: string; cuit: string; razonSocial: string; descriptores: string[] };

export function identificarCliente(descriptor: string, clientes: ClienteSugerible[]): string | null {
  const digitos = descriptor.replace(/\D/g, ' ');
  for (const c of clientes) {
    if (c.cuit && c.cuit.length === 11 && digitos.includes(c.cuit)) return c.id;
  }
  const norm = normalizarDescriptor(descriptor);
  let mejor: { id: string; score: number } | null = null;
  for (const c of clientes) {
    const score = Math.max(
      similitudTexto(norm, c.razonSocial),
      ...c.descriptores.map((d) => similitudTexto(norm, d) + 0.05),
    );
    if (!mejor || score > mejor.score) mejor = { id: c.id, score };
  }
  return mejor && mejor.score >= 0.5 ? mejor.id : null;
}

export type FacturaSugerible = { id: string; saldoArs: number | null; fecha?: Date | null };

const TOL = 1; // pesos

/**
 * Mejor combinación de hasta `maxFacturas` facturas cuya suma (pesificada)
 * explica el monto: exacta (±1 peso) o neta de retenciones (el crédito entre
 * 95% y 100% de la suma). Prefiere exacta, después menos facturas, después la
 * menor diferencia. null si ninguna califica.
 */
export function sugerirCombinacion(monto: number, facturas: FacturaSugerible[], maxFacturas = 3, fechaCredito: Date | null = null): string[] | null {
  const pool = facturas
    .filter((f): f is { id: string; saldoArs: number; fecha?: Date | null } => f.saldoArs != null && f.saldoArs > 0 && cobroPosibleEnFecha(fechaCredito, f.fecha ?? null))
    .sort((a, b) => Math.abs(a.saldoArs - monto) - Math.abs(b.saldoArs - monto))
    .slice(0, 15);
  let mejor: { ids: string[]; exacta: boolean; dif: number } | null = null;
  const evaluar = (ids: string[], suma: number) => {
    const dif = suma - monto;
    const exacta = Math.abs(dif) <= TOL;
    const neta = dif > TOL && monto >= suma * (1 - UMBRAL_RETENCION);
    if (!exacta && !neta) return;
    const cand = { ids, exacta, dif: Math.abs(dif) };
    if (
      !mejor
      || (cand.exacta && !mejor.exacta)
      || (cand.exacta === mejor.exacta && (cand.ids.length < mejor.ids.length || (cand.ids.length === mejor.ids.length && cand.dif < mejor.dif)))
    ) mejor = cand;
  };
  const n = pool.length;
  for (let i = 0; i < n; i++) {
    evaluar([pool[i].id], pool[i].saldoArs);
    if (maxFacturas < 2) continue;
    for (let j = i + 1; j < n; j++) {
      evaluar([pool[i].id, pool[j].id], pool[i].saldoArs + pool[j].saldoArs);
      if (maxFacturas < 3) continue;
      for (let k = j + 1; k < n; k++) evaluar([pool[i].id, pool[j].id, pool[k].id], pool[i].saldoArs + pool[j].saldoArs + pool[k].saldoArs);
    }
  }
  return mejor ? (mejor as { ids: string[] }).ids : null;
}
