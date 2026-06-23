import { DomainError } from '@/lib/errors';

// Percentage split across cost centers (+ optional client/project).
// The sum of percentages must be EXACTLY 100 (4 decimals). Derived per-line
// amounts are rounded to the cent, with the last line absorbing the rounding
// remainder so lines always add up to the exact signed total.

export type LineaDistribucion = {
  centroCostoId: string;
  clienteId?: string | null;
  porcentaje: number; // 0 < p <= 100, up to 4 decimals
};

/** Percentage expressed in integer hundredths-of-basis-points (4 decimals). */
function pctEntero(p: number): number {
  return Math.round(p * 10000);
}

export function validarDistribucion(lineas: LineaDistribucion[]): void {
  if (!lineas.length) {
    throw new DomainError('El movimiento debe tener al menos una línea de asignación.');
  }
  for (const l of lineas) {
    if (!l.centroCostoId) throw new DomainError('Cada línea de asignación necesita un centro de costo.');
    if (!(l.porcentaje > 0)) throw new DomainError('Los porcentajes deben ser mayores a 0.');
    if (pctEntero(l.porcentaje) > 1000000) throw new DomainError('Ningún porcentaje puede superar 100.');
  }
  const suma = lineas.reduce((acc, l) => acc + pctEntero(l.porcentaje), 0);
  if (suma !== 1000000) {
    throw new DomainError(
      `Los porcentajes deben sumar exactamente 100 (suman ${(suma / 10000).toFixed(4)}).`,
    );
  }
}

/**
 * Derived amount per line, in cents. The last line absorbs rounding so the
 * lines sum the signed total exactly.
 */
export function importesPorLinea(totalFirmadoCentavos: number, lineas: LineaDistribucion[]): number[] {
  validarDistribucion(lineas);
  const importes: number[] = [];
  let acumulado = 0;
  for (let i = 0; i < lineas.length; i++) {
    if (i === lineas.length - 1) {
      importes.push(totalFirmadoCentavos - acumulado);
    } else {
      const importe = Math.round((totalFirmadoCentavos * pctEntero(lineas[i].porcentaje)) / 1000000);
      importes.push(importe);
      acumulado += importe;
    }
  }
  return importes;
}

/** Equal split helper ("repartir en partes iguales"), 4-decimal safe. */
export function repartirEnPartesIguales(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(1000000 / n);
  const resto = 1000000 - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? resto : 0)) / 10000);
}
