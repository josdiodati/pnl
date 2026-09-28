import { formatMoney, formatFecha } from '@/lib/format';
import { INSTRUMENTO_LABEL, ESTADO_COBRO_LABEL, ES_CHEQUE } from '@/lib/cobranzas/labels';
import type { EventoCrudo, EventoFormateado } from './formato';

// Historial de un cobro (AuditLog entidad 'Cobro', entidadId = grupo): quién
// lo cargó, quién lo editó y qué cambió, cheques acreditados o rechazados,
// confirmación contra el resumen bancario. Puro; tolera payloads viejos.

export type ReferenciasCobro = {
  usuarios?: Map<string, string>;
  /** id de venta → etiqueta ("FACTURA A 00002-123"). */
  ventas?: Map<string, string>;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

function importe(monto: unknown, moneda: unknown): string {
  const m = str(moneda);
  return `${formatMoney(String(monto ?? 0))}${m && m !== 'ARS' ? ` ${m}` : ''}`;
}

/** "Transferencia $ 1.000,00 · n° 12 · Galicia" */
export function describirInstrumento(i: Obj): string {
  const tipo = INSTRUMENTO_LABEL[String(i.instrumento)] ?? String(i.instrumento ?? 'Instrumento');
  const partes = [`${tipo} ${importe(i.monto, i.moneda)}`];
  if (str(i.numero)) partes.push(`n° ${i.numero}`);
  if (str(i.banco)) partes.push(String(i.banco));
  if (i.fecha) partes.push(`recibido ${formatFecha(String(i.fecha))}`);
  const acredita = i.fechaAcreditacion ? String(i.fechaAcreditacion) : null;
  if (acredita && acredita.slice(0, 10) !== String(i.fecha ?? '').slice(0, 10)) {
    // Los eventos viejos no guardaban la fecha de recepción: fuera de los cheques es la misma.
    partes.push(`${i.fecha || ES_CHEQUE.has(String(i.instrumento)) ? 'acredita' : 'fecha'} ${formatFecha(acredita)}`);
  }
  return partes.join(' · ');
}

const CAMPOS: [campo: string, etiqueta: string][] = [
  ['instrumento', 'tipo'],
  ['monto', 'monto'],
  ['moneda', 'moneda'],
  ['fecha', 'recibido'],
  ['fechaAcreditacion', 'acreditación'],
  ['numero', 'n°'],
  ['banco', 'banco'],
];

function valor(campo: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (campo === 'instrumento') return INSTRUMENTO_LABEL[String(v)] ?? String(v);
  if (campo === 'monto') return formatMoney(String(v));
  if (campo === 'fecha' || campo === 'fechaAcreditacion') return formatFecha(String(v));
  return String(v);
}

function igual(campo: string, a: unknown, b: unknown): boolean {
  if ((a == null || a === '') && (b == null || b === '')) return true;
  if (campo === 'monto') return Number(a) === Number(b);
  if (campo === 'fecha' || campo === 'fechaAcreditacion') return String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10);
  return String(a ?? '') === String(b ?? '');
}

/** Diff de una edición: por instrumento (emparejado por cobroId si lo hay) + nota y cotización. */
export function diffEdicion(antes: unknown, despues: unknown): string[] {
  const a = obj(antes);
  const d = obj(despues);
  const out: string[] = [];
  const ia = arr(a.instrumentos);
  const id = arr(d.instrumentos);
  const usados = new Set<number>();
  // Emparejado: por cobroId; si no, por tipo en orden (la re-persistencia cambia los ids).
  const pareja = (x: Obj): number => {
    let k = str(x.cobroId) ? ia.findIndex((y, j) => !usados.has(j) && y.cobroId === x.cobroId) : -1;
    if (k < 0) k = ia.findIndex((y, j) => !usados.has(j) && y.instrumento === x.instrumento);
    return k;
  };
  for (const x of id) {
    const k = pareja(x);
    if (k < 0) {
      out.push(`Agregado: ${describirInstrumento(x)}`);
      continue;
    }
    usados.add(k);
    const y = ia[k];
    const cambios = CAMPOS.filter(([c]) => (c in y || c in x) && !igual(c, y[c], x[c])).map(([c, et]) => `${et}: ${valor(c, y[c])} → ${valor(c, x[c])}`);
    if (cambios.length) out.push(`${INSTRUMENTO_LABEL[String(x.instrumento)] ?? x.instrumento}: ${cambios.join('; ')}`);
  }
  ia.forEach((y, j) => { if (!usados.has(j)) out.push(`Quitado: ${describirInstrumento(y)}`); });
  if ('nota' in d && !igual('nota', a.nota, d.nota)) out.push(`nota: ${valor('nota', a.nota)} → ${valor('nota', d.nota)}`);
  if (!igual('monto', a.cotizacion ?? '', d.cotizacion ?? '') && (a.cotizacion != null || d.cotizacion != null)) {
    out.push(`cotización: ${a.cotizacion ?? '—'} → ${d.cotizacion ?? '—'}`);
  }
  return out;
}

function formatear(e: EventoCrudo, refs: ReferenciasCobro): Omit<EventoFormateado, 'id' | 'fecha' | 'actor'> {
  const d = obj(e.despues);
  const a = obj(e.antes);
  const detalles: string[] = [];
  const ventas = (ids: unknown) => (Array.isArray(ids) ? ids.map((v) => refs.ventas?.get(String(v)) ?? String(v)) : []);

  switch (e.accion) {
    case 'COBRO_REGISTRAR': {
      for (const i of arr(d.instrumentos)) detalles.push(describirInstrumento(i));
      const vs = ventas(d.ventas);
      if (vs.length) detalles.push(`Aplicado a ${vs.join(', ')}`);
      if (str(d.nota)) detalles.push(`Nota: ${d.nota}`);
      const ajustes = Object.keys(obj(d.ajustes)).length;
      if (ajustes) detalles.push(`Generó ${ajustes} ajuste${ajustes > 1 ? 's' : ''} por diferencia de cambio`);
      return { titulo: d.origen === 'RESUMEN' ? 'Cobro creado al conciliar el resumen bancario' : 'Cobro cargado', detalles, tecnico: null };
    }
    case 'COBRO_EDITAR': {
      const cambios = diffEdicion(e.antes, e.despues);
      return { titulo: 'Cobro editado', detalles: cambios.length ? cambios : ['Sin cambios visibles'], tecnico: { antes: e.antes, despues: e.despues } };
    }
    case 'COBRO_CHEQUE_ACREDITAR':
      if (d.fechaAcreditacion) detalles.push(`Fecha de acreditación: ${formatFecha(String(d.fechaAcreditacion))}`);
      return { titulo: 'Cheque marcado como acreditado', detalles, tecnico: null };
    case 'COBRO_CHEQUE_RECHAZAR':
      if (str(d.motivo)) detalles.push(`Motivo: ${d.motivo}`);
      return { titulo: 'Cheque marcado como rechazado: la factura vuelve a deberse', detalles, tecnico: null };
    case 'COBRO_CONFIRMAR_RESUMEN':
      if (str(d.descriptor)) detalles.push(`Línea del banco: «${d.descriptor}»`);
      return { titulo: 'Confirmado por el resumen bancario', detalles, tecnico: null };
    case 'COBRO_DESCONFIRMAR_RESUMEN':
      return { titulo: 'Se deshizo la confirmación del resumen bancario', detalles, tecnico: null };
    case 'COBRO_ELIMINAR':
      for (const i of arr(a.instrumentos)) detalles.push(`${describirInstrumento(i)}${str(i.estado) ? ` (${ESTADO_COBRO_LABEL[String(i.estado)] ?? i.estado})` : ''}`);
      return { titulo: 'Cobro eliminado', detalles, tecnico: null };
    default:
      return { titulo: e.accion, detalles, tecnico: e.despues ?? e.antes ?? null };
  }
}

export function formatearHistorialCobro(eventos: EventoCrudo[], refs: ReferenciasCobro = {}): EventoFormateado[] {
  return eventos.map((e) => ({
    id: e.id,
    fecha: e.createdAt,
    actor: e.usuarioId ? (refs.usuarios?.get(e.usuarioId) ?? 'Usuario') : 'Sistema',
    ...formatear(e, refs),
  }));
}
