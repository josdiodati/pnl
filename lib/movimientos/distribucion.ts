import { DomainError } from '@/lib/errors';

// Percentage split across cost centers (+ optional client/project).
// The sum of percentages must be EXACTLY 100 (up to 10 decimals). Derived
// per-line amounts are rounded to the cent, with the last line absorbing the
// rounding remainder so lines always add up to the exact signed total.
//
// Percentages typed by hand use up to 4 decimals. A split loaded "por monto
// neto" stores the derived percentage with 10 decimals, enough for the amounts
// to come back to the cent on the comprobante's neto (see porcentajesDesdeMontos).

export type LineaDistribucion = {
  centroCostoId: string;
  clienteId?: string | null;
  proyectoId?: string | null;
  porcentaje: number; // 0 < p <= 100, up to 10 decimals
};

/** Decimals a stored percentage may carry (DB columns are Decimal(13, 10)). */
export const DECIMALES_PORCENTAJE = 10;
const ESCALA = 10 ** DECIMALES_PORCENTAJE;
const CIEN = 100 * ESCALA;

/** Percentage expressed as an integer at 10 decimals. */
function pctEntero(p: number): number {
  return Math.round(p * ESCALA);
}

/** Lines whose percentages add up to exactly 100 (at 10 decimals). */
export function sumaCien(porcentajes: number[]): boolean {
  return porcentajes.reduce((acc, p) => acc + pctEntero(p), 0) === CIEN;
}

export function validarDistribucion(lineas: LineaDistribucion[]): void {
  if (!lineas.length) {
    throw new DomainError('El movimiento debe tener al menos una línea de asignación.');
  }
  for (const l of lineas) {
    if (!l.centroCostoId) throw new DomainError('Cada línea de asignación necesita un centro de costo.');
    if (!(l.porcentaje > 0)) throw new DomainError('Los porcentajes deben ser mayores a 0.');
    if (pctEntero(l.porcentaje) > CIEN) throw new DomainError('Ningún porcentaje puede superar 100.');
  }
  const suma = lineas.reduce((acc, l) => acc + pctEntero(l.porcentaje), 0);
  if (suma !== CIEN) {
    const texto = Number((suma / ESCALA).toFixed(DECIMALES_PORCENTAJE)).toLocaleString('es-AR', { maximumFractionDigits: DECIMALES_PORCENTAJE });
    throw new DomainError(`Los porcentajes deben sumar exactamente 100 (suman ${texto}).`);
  }
}

/**
 * Derived amount per line, in cents. The last line absorbs rounding so the
 * lines sum the signed total exactly.
 */
export function importesPorLinea(totalFirmadoCentavos: number, lineas: LineaDistribucion[]): number[] {
  validarDistribucion(lineas);
  return montosDesdePorcentajes(lineas.map((l) => l.porcentaje), totalFirmadoCentavos);
}

/** Amount per percentage, in cents; the last absorbs rounding. No validation. */
export function montosDesdePorcentajes(porcentajes: number[], totalCentavos: number): number[] {
  const montos: number[] = [];
  let acumulado = 0;
  porcentajes.forEach((p, i) => {
    if (i === porcentajes.length - 1) {
      montos.push(totalCentavos - acumulado);
    } else {
      const monto = Math.round((totalCentavos * pctEntero(p)) / CIEN);
      montos.push(monto);
      acumulado += monto;
    }
  });
  return montos;
}

/**
 * Reparto por monto: the percentage of each amount over the neto, at 10
 * decimals. When the amounts add up to the neto the last line absorbs the
 * rounding so they sum exactly 100 — and importesPorLinea(neto) gives back
 * the same amounts. When they don't, the result doesn't sum 100 and the
 * validation rejects it (the editor shows what's missing).
 */
export function porcentajesDesdeMontos(montosCentavos: number[], netoCentavos: number): number[] {
  if (!netoCentavos) return montosCentavos.map(() => 0);
  const cierra = montosCentavos.reduce((a, m) => a + m, 0) === netoCentavos;
  let acumulado = 0;
  return montosCentavos.map((m, i) => {
    const entero =
      cierra && i === montosCentavos.length - 1 ? CIEN - acumulado : Math.round((m * CIEN) / netoCentavos);
    acumulado += entero;
    return entero / ESCALA;
  });
}

/** A split with more than 4 decimals was loaded by amount (hand-typed % use 4). */
export function esRepartoPorMonto(porcentajes: number[]): boolean {
  return porcentajes.some((p) => pctEntero(p) % 10 ** (DECIMALES_PORCENTAJE - 4) !== 0);
}

/**
 * Rounds percentages that add up to 100 to fewer decimals keeping the sum at
 * 100 (the last absorbs). Rules and templates keep readable percentages: a
 * split loaded by amount becomes the equivalent rounded percentages.
 */
export function redondearPorcentajes(porcentajes: number[], decimales: number): number[] {
  const escala = 10 ** decimales;
  let acumulado = 0;
  return porcentajes.map((p, i) => {
    const entero = i === porcentajes.length - 1 ? 100 * escala - acumulado : Math.round(p * escala);
    acumulado += entero;
    return entero / escala;
  });
}

/** Equal split helper ("repartir en partes iguales"), 4-decimal safe. */
export function repartirEnPartesIguales(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(1000000 / n);
  const resto = 1000000 - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? resto : 0)) / 10000);
}
