// CUIT validation: 11 digits, last one is a mod-11 check digit.
// Weights for the first 10 digits: 5 4 3 2 7 6 5 4 3 2.
// dv = 11 - (sum % 11); 11 -> 0; 10 -> no valid CUIT exists with that base.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Strips dashes, dots and spaces. Returns the bare digit string. */
export function normalizarCuit(cuit: string): string {
  return cuit.replace(/[-.\s]/g, '');
}

export function cuitEsValido(cuit: string | null | undefined): boolean {
  if (!cuit) return false;
  const limpio = normalizarCuit(cuit);
  if (!/^\d{11}$/.test(limpio)) return false;
  const digitos = limpio.split('').map(Number);
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * digitos[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === digitos[10];
}

/** Formats 20123456786 as 20-12345678-6 (display only). */
export function formatearCuit(cuit: string): string {
  const c = normalizarCuit(cuit);
  if (c.length !== 11) return cuit;
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}
