import { importesDesdeCeldas, numeroAr } from './csv';
import type { FilaMisComprobantes, OrigenMisComprobantes } from './tipos';

// `datos.data` de listaResultados: array de arrays SIN nombres. 49 posiciones
// en emitidos y 52 en recibidos; los importes van de a dos (valor, null) a
// partir de la posición 15 / 18. Mapeo verificado contra el CSV de la misma
// consulta (Docs/arca-relevamiento-mcmp/mapeo-json-a-csv.json). Si ARCA cambia
// el largo de las filas, se corta acá en vez de leer cualquier cosa.

const LARGO = { EMITIDO: 49, RECIBIDO: 52 } as const;

function celda(fila: unknown[], i: number): string | null {
  const v = fila[i];
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function fechaIso(ddmmyyyy: string | null): string {
  const m = ddmmyyyy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Mis Comprobantes: fecha inesperada en el JSON: «${ddmmyyyy}»`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function entero(v: string | null, campo: string): number {
  const n = Number(v);
  if (v == null || !Number.isInteger(n)) throw new Error(`Mis Comprobantes: ${campo} inválido en el JSON: «${v}»`);
  return n;
}

export function filasDesdeJsonMisComprobantes(data: unknown[][], origen: OrigenMisComprobantes): FilaMisComprobantes[] {
  return data.map((fila, n) => {
    if (!Array.isArray(fila) || fila.length !== LARGO[origen]) {
      throw new Error(`Mis Comprobantes: la fila ${n} del JSON tiene ${Array.isArray(fila) ? fila.length : '?'} posiciones y se esperaban ${LARGO[origen]} (${origen}): cambió el formato del portal.`);
    }
    const esRecibido = origen === 'RECIBIDO';
    // Importes: pares (valor, null) desde 15 (emitidos) o 18 (recibidos).
    const inicio = esRecibido ? 18 : 15;
    const importes: (string | null)[] = [];
    for (let i = 0; i < 17; i++) importes.push(celda(fila, inicio + i * 2)?.replace('.', ',') ?? null);
    return {
      fechaEmision: fechaIso(celda(fila, 0)),
      tipoComprobante: entero(celda(fila, 1), 'tipo de comprobante'),
      puntoVenta: entero(celda(fila, 3), 'punto de venta'),
      numeroDesde: entero(celda(fila, 4), 'número desde'),
      numeroHasta: entero(celda(fila, 5), 'número hasta'),
      codigoAutorizacion: celda(fila, 8),
      tipoDocContraparte: celda(fila, 10) != null ? entero(celda(fila, 10), 'tipo doc') : null,
      nroDocContraparte: celda(fila, 11) ?? '',
      denominacionContraparte: celda(fila, 12),
      nroDocReceptor: esRecibido ? celda(fila, 15) : null,
      tipoCambio: numeroAr(celda(fila, esRecibido ? 16 : 13)?.replace('.', ',')),
      moneda: celda(fila, esRecibido ? 17 : 14),
      ...importesDesdeCeldas(importes),
    };
  });
}
