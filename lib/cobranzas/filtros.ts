import type { InfoCobro } from './query';
import { inicioSemana, tramo, TRAMOS_ANTIGUEDAD } from './proyeccion';

// Filtros de Ventas que reproducen cada número de la vista Cobranzas: cada
// monto de Cobranzas linkea a Ventas con el filtro que selecciona exactamente
// las facturas que lo componen (mismas reglas que proyectarCobranzas).

const DIA_MS = 86_400_000;
export const HORIZONTE_SEMANAS = 12;

export type FiltroCobranza = {
  cobro?: string; // pendientes | vencidas | cobradas | cheques | prox30 | despues
  tramo?: string; // índice de TRAMOS_ANTIGUEDAD
  semana?: string; // lunes YYYY-MM-DD de la semana de la proyección
};

const porCobrar = (i: InfoCobro) => (i.estado === 'PENDIENTE' || i.estado === 'PARCIAL') && (i.saldoArs ?? 0) > 0;
const estimadaFutura = (i: InfoCobro) => porCobrar(i) && i.diasVencida <= 0 && i.fechaProbable != null;

export function hayFiltroCobranza(f: FiltroCobranza): boolean {
  return Boolean(f.cobro || f.tramo || f.semana);
}

export function coincideFiltroCobranza(i: InfoCobro, f: FiltroCobranza, hoy: Date): boolean {
  const inicio = inicioSemana(hoy);
  const fin = inicio.getTime() + HORIZONTE_SEMANAS * 7 * DIA_MS;
  const limite30 = hoy.getTime() + 30 * DIA_MS;
  switch (f.cobro) {
    case undefined:
    case '':
      break;
    case 'pendientes': if (!(i.estado === 'PENDIENTE' || i.estado === 'PARCIAL')) return false; break;
    case 'vencidas': if (!(porCobrar(i) && i.vencida)) return false; break;
    case 'cobradas': if (i.estado !== 'COBRADA') return false; break;
    case 'cheques': if (i.chequesEnCartera.length === 0) return false; break;
    case 'prox30':
      if (!((estimadaFutura(i) && i.fechaProbable!.fecha.getTime() <= limite30)
        || i.chequesEnCartera.some((c) => c.fechaAcreditacion.getTime() <= limite30))) return false;
      break;
    case 'despues':
      if (!((estimadaFutura(i) && i.fechaProbable!.fecha.getTime() >= fin)
        || i.chequesEnCartera.some((c) => c.fechaAcreditacion.getTime() >= fin))) return false;
      break;
    default: return false;
  }
  if (f.tramo) {
    const k = Number(f.tramo);
    if (!Number.isInteger(k) || k < 0 || k >= TRAMOS_ANTIGUEDAD.length) return false;
    if (!porCobrar(i) || tramo(i.diasVencida) !== k) return false;
  }
  if (f.semana) {
    const desde = new Date(`${f.semana}T00:00:00Z`).getTime();
    if (Number.isNaN(desde)) return false;
    const hasta = desde + 7 * DIA_MS;
    const enSemana = (t: number) => { const c = Math.max(t, inicio.getTime()); return c >= desde && c < hasta; };
    if (!((estimadaFutura(i) && enSemana(i.fechaProbable!.fecha.getTime()))
      || i.chequesEnCartera.some((c) => enSemana(c.fechaAcreditacion.getTime())))) return false;
  }
  return true;
}

export function describirFiltroCobranza(f: FiltroCobranza): string | null {
  const partes: string[] = [];
  const cobro: Record<string, string> = {
    pendientes: 'por cobrar', vencidas: 'vencidas', cobradas: 'cobradas', cheques: 'con cheques en cartera',
    prox30: 'que entran en los próximos 30 días', despues: 'que entran después de 12 semanas',
  };
  if (f.cobro && cobro[f.cobro]) partes.push(cobro[f.cobro]);
  if (f.tramo && TRAMOS_ANTIGUEDAD[Number(f.tramo)]) {
    const t = TRAMOS_ANTIGUEDAD[Number(f.tramo)];
    partes.push(Number(f.tramo) === 0 ? 'a vencer' : `vencidas ${t} días`);
  }
  if (f.semana) partes.push(`que entran la semana del ${f.semana.split('-').reverse().join('/')}`);
  return partes.length ? `Facturas ${partes.join(', ')}` : null;
}

/**
 * Ids de las ventas que cumplen el filtro de cobranza (null si no hay filtro).
 * La vista Comprobantes los usa para el drill-down desde Cobranzas.
 */
export async function idsPorFiltroCobranza(
  mapa: Map<string, InfoCobro>,
  f: FiltroCobranza,
  hoy: Date,
): Promise<string[] | null> {
  if (!hayFiltroCobranza(f)) return null;
  return [...mapa].filter(([, i]) => coincideFiltroCobranza(i, f, hoy)).map(([id]) => id);
}
