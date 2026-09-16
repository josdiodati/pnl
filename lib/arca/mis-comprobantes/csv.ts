import { ALICUOTAS, type FilaMisComprobantes, type OrigenMisComprobantes } from './tipos';

// CSV que exporta "Mis Comprobantes" (descargarComprobantes.do?tf=csv, dentro
// de un ZIP): UTF-8, separador ';', encabezado entrecomillado y filas sin
// comillas, fecha yyyy-mm-dd, decimales con coma. 28 columnas en emitidos
// (contraparte = receptor) y 30 en recibidos (emisor y receptor).

const COLUMNAS_COMUNES_INICIO = ['Fecha de Emisión', 'Tipo de Comprobante', 'Punto de Venta', 'Número Desde', 'Número Hasta', 'Cód. Autorización'];
const COLUMNAS_IMPORTES = [
  'Imp. Neto Gravado IVA 0%',
  'IVA 2,5%', 'Imp. Neto Gravado IVA 2,5%',
  'IVA 5%', 'Imp. Neto Gravado IVA 5%',
  'IVA 10,5%', 'Imp. Neto Gravado IVA 10,5%',
  'IVA 21%', 'Imp. Neto Gravado IVA 21%',
  'IVA 27%', 'Imp. Neto Gravado IVA 27%',
  'Imp. Neto Gravado Total', 'Imp. Neto No Gravado', 'Imp. Op. Exentas', 'Otros Tributos', 'Total IVA', 'Imp. Total',
];

function dividir(linea: string): string[] {
  // Sin comillas en los datos salvo el encabezado; las comillas se quitan.
  return linea.split(';').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
}

export function numeroAr(celda: string | null | undefined): number | null {
  if (celda == null) return null;
  const t = celda.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function entero(celda: string, campo: string): number {
  const n = Number(celda.trim());
  if (!Number.isInteger(n)) throw new Error(`Mis Comprobantes: ${campo} inválido: «${celda}»`);
  return n;
}

/** Arma la parte de importes a partir de las 17 celdas de importes en el orden del reporte. */
export function importesDesdeCeldas(celdas: (string | null | undefined)[]): Pick<FilaMisComprobantes, 'ivaPorAlicuota' | 'netoGravadoTotal' | 'netoNoGravado' | 'exentas' | 'otrosTributos' | 'totalIva' | 'importeTotal'> {
  if (celdas.length !== 17) throw new Error(`Mis Comprobantes: se esperaban 17 celdas de importes y vinieron ${celdas.length}`);
  const v = celdas.map(numeroAr);
  const ivaPorAlicuota: Record<string, { iva?: number; neto?: number }> = {};
  if (v[0] != null) ivaPorAlicuota['0'] = { neto: v[0] };
  ALICUOTAS.forEach((al, i) => {
    const iva = v[1 + i * 2];
    const neto = v[2 + i * 2];
    if (iva != null || neto != null) ivaPorAlicuota[al] = { ...(iva != null ? { iva } : {}), ...(neto != null ? { neto } : {}) };
  });
  return {
    ivaPorAlicuota,
    netoGravadoTotal: v[11],
    netoNoGravado: v[12],
    exentas: v[13],
    otrosTributos: v[14],
    totalIva: v[15],
    importeTotal: v[16],
  };
}

export function parsearCsvMisComprobantes(texto: string): { origen: OrigenMisComprobantes; filas: FilaMisComprobantes[] } {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const cabecera = dividir(lineas[0] ?? '');
  const esRecibido = cabecera.includes('Nro. Doc. Emisor');
  const esperada = esRecibido
    ? [...COLUMNAS_COMUNES_INICIO, 'Tipo Doc. Emisor', 'Nro. Doc. Emisor', 'Denominación Emisor', 'Tipo Doc. Receptor', 'Nro. Doc. Receptor', 'Tipo Cambio', 'Moneda', ...COLUMNAS_IMPORTES]
    : [...COLUMNAS_COMUNES_INICIO, 'Tipo Doc. Receptor', 'Nro. Doc. Receptor', 'Denominación Receptor', 'Tipo Cambio', 'Moneda', ...COLUMNAS_IMPORTES];
  if (cabecera.length !== esperada.length || esperada.some((c, i) => cabecera[i] !== c)) {
    throw new Error('El archivo no es un CSV de Mis Comprobantes de ARCA (encabezado desconocido).');
  }
  const origen: OrigenMisComprobantes = esRecibido ? 'RECIBIDO' : 'EMITIDO';
  const filas: FilaMisComprobantes[] = [];
  for (const linea of lineas.slice(1)) {
    if (!linea.trim()) continue;
    const c = dividir(linea);
    if (c.length !== esperada.length) throw new Error(`Mis Comprobantes: fila con ${c.length} columnas (se esperaban ${esperada.length}).`);
    const base = {
      fechaEmision: c[0],
      tipoComprobante: entero(c[1], 'tipo de comprobante'),
      puntoVenta: entero(c[2], 'punto de venta'),
      numeroDesde: entero(c[3], 'número desde'),
      numeroHasta: entero(c[4], 'número hasta'),
      codigoAutorizacion: c[5] || null,
    };
    let resto: string[];
    let contraparte: Pick<FilaMisComprobantes, 'tipoDocContraparte' | 'nroDocContraparte' | 'denominacionContraparte' | 'nroDocReceptor'>;
    if (esRecibido) {
      contraparte = { tipoDocContraparte: c[6] ? entero(c[6], 'tipo doc emisor') : null, nroDocContraparte: c[7] ?? '', denominacionContraparte: c[8] || null, nroDocReceptor: c[10] || null };
      resto = c.slice(11);
    } else {
      contraparte = { tipoDocContraparte: c[6] ? entero(c[6], 'tipo doc receptor') : null, nroDocContraparte: c[7] ?? '', denominacionContraparte: c[8] || null, nroDocReceptor: null };
      resto = c.slice(9);
    }
    filas.push({
      ...base,
      ...contraparte,
      tipoCambio: numeroAr(resto[0]),
      moneda: resto[1] || null,
      ...importesDesdeCeldas(resto.slice(2)),
    });
  }
  return { origen, filas };
}
