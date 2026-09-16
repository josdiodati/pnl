import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parsearCsvMisComprobantes } from '@/lib/arca/mis-comprobantes/csv';
import { filasDesdeJsonMisComprobantes } from '@/lib/arca/mis-comprobantes/json';
import { extraerCsvDeZip } from '@/lib/arca/mis-comprobantes/zip';
import { cifrarSecreto, descifrarSecreto } from '@/lib/arca/mis-comprobantes/cifrado';

// Formatos del servicio "Mis Comprobantes" de ARCA, según el relevamiento
// del 16-sep-2026 (Docs/arca-relevamiento-mcmp): CSV con ';' y decimales con
// coma (28 columnas emitidos / 30 recibidos), JSON posicional (49 / 52
// posiciones), ZIP con un único CSV adentro.

const CAB_EMITIDOS =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Denominación Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"';
const CAB_RECIBIDOS =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"';

const FILA_EMITIDA = '2026-08-19;1;2;686;686;86338977428571;80;30718332148;PROVEEDOR EJEMPLO S.R.L.;1,00;$;;;;;;;;525000,00;2500000,00;;;2500000,00;0,00;0,00;0,00;525000,00;3025000,00';
const FILA_EMITIDA_USD = '2026-08-19;19;3;170;170;86338990828535;80;55000002126;Cliente Exterior;1495,00;USD;;;;;;;;;;;;0,00;24775,17;0,00;0,00;0,00;24775,17';
const FILA_RECIBIDA = '2026-08-01;1;1007;4312246;4312246;86294874222078;80;30656631615;ALARMAS EJEMPLO S.A.;80;30712093486;1,00;$;;;;;;;;19305,30;91929,98;;;91929,98;0,00;0,00;2757,90;19305,30;113993,18';
const FILA_RECIBIDA_CF = '2026-08-02;6;5;12;12;86294874222079;;;;80;30712093486;1,00;$;;;;;;;;;;;;0,00;0,00;1000,00;0,00;0,00;1000,00';

describe('parsearCsvMisComprobantes', () => {
  it('detecta EMITIDO por el encabezado y parsea fechas, códigos e importes con coma', () => {
    const r = parsearCsvMisComprobantes(`﻿${CAB_EMITIDOS}\n${FILA_EMITIDA}\n`);
    expect(r.origen).toBe('EMITIDO');
    expect(r.filas).toHaveLength(1);
    const f = r.filas[0];
    expect(f.fechaEmision).toBe('2026-08-19');
    expect(f.tipoComprobante).toBe(1);
    expect(f.puntoVenta).toBe(2);
    expect(f.numeroDesde).toBe(686);
    expect(f.numeroHasta).toBe(686);
    expect(f.codigoAutorizacion).toBe('86338977428571');
    expect(f.tipoDocContraparte).toBe(80);
    expect(f.nroDocContraparte).toBe('30718332148');
    expect(f.denominacionContraparte).toBe('PROVEEDOR EJEMPLO S.R.L.');
    expect(f.tipoCambio).toBe(1);
    expect(f.moneda).toBe('$');
    expect(f.netoGravadoTotal).toBe(2500000);
    expect(f.totalIva).toBe(525000);
    expect(f.importeTotal).toBe(3025000);
    expect(f.ivaPorAlicuota['21']).toEqual({ iva: 525000, neto: 2500000 });
    expect(f.ivaPorAlicuota['10.5']).toBeUndefined();
  });

  it('detecta RECIBIDO: la contraparte es el emisor y guarda el CUIT receptor', () => {
    const r = parsearCsvMisComprobantes(`${CAB_RECIBIDOS}\n${FILA_RECIBIDA}\n${FILA_RECIBIDA_CF}`);
    expect(r.origen).toBe('RECIBIDO');
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0].nroDocContraparte).toBe('30656631615');
    expect(r.filas[0].denominacionContraparte).toBe('ALARMAS EJEMPLO S.A.');
    expect(r.filas[0].nroDocReceptor).toBe('30712093486');
    expect(r.filas[0].otrosTributos).toBe(2757.9);
    // Sin contraparte (consumidor final): CUIT vacío, no null (es parte de la clave natural).
    expect(r.filas[1].nroDocContraparte).toBe('');
    expect(r.filas[1].tipoDocContraparte).toBeNull();
    expect(r.filas[1].exentas).toBe(1000);
  });

  it('moneda extranjera: conserva moneda y tipo de cambio tal como vienen', () => {
    const r = parsearCsvMisComprobantes(`${CAB_EMITIDOS}\n${FILA_EMITIDA_USD}`);
    expect(r.filas[0].moneda).toBe('USD');
    expect(r.filas[0].tipoCambio).toBe(1495);
    expect(r.filas[0].netoNoGravado).toBe(24775.17);
    expect(r.filas[0].importeTotal).toBe(24775.17);
  });

  it('rechaza un CSV que no es de Mis Comprobantes', () => {
    expect(() => parsearCsvMisComprobantes('a;b;c\n1;2;3')).toThrow(/Mis Comprobantes/);
  });

  it('las filas vacías del final no cuentan', () => {
    const r = parsearCsvMisComprobantes(`${CAB_EMITIDOS}\n${FILA_EMITIDA}\n\n\n`);
    expect(r.filas).toHaveLength(1);
  });
});

describe('filasDesdeJsonMisComprobantes', () => {
  const filaJsonEmitida = ['19/08/2026', '1', null, '2', '686', '686', null, null, '86338977428571', null, '80', '30718332148', 'PROVEEDOR EJEMPLO S.R.L.', '1', '$',
    null, null, null, null, null, null, null, null, null, null, null, null, null, null, '525000', null, '2500000', null, null, null, null, null, '2500000', null, '0', null, '0', null, '0', null, '525000', null, '3025000', null];
  const filaJsonRecibida = ['01/08/2026', '1', null, '1007', '4312246', '4312246', null, null, '86294874222078', null, '80', '30656631615', 'ALARMAS EJEMPLO S.A.', null, '80', '30712093486', '1', '$',
    null, null, null, null, null, null, null, null, null, null, null, null, null, null, '19305.3', null, '91929.98', null, null, null, null, null, '91929.98', null, '0', null, '0', null, '2757.9', null, '19305.3', null, '113993.18', null];

  it('mapea las 49 posiciones de emitidos igual que el CSV', () => {
    const json = filasDesdeJsonMisComprobantes([filaJsonEmitida], 'EMITIDO');
    const csv = parsearCsvMisComprobantes(`${CAB_EMITIDOS}\n${FILA_EMITIDA}`).filas;
    expect(json).toEqual(csv);
  });

  it('mapea las 52 posiciones de recibidos igual que el CSV', () => {
    const json = filasDesdeJsonMisComprobantes([filaJsonRecibida], 'RECIBIDO');
    const csv = parsearCsvMisComprobantes(`${CAB_RECIBIDOS}\n${FILA_RECIBIDA}`).filas;
    expect(json).toEqual(csv);
  });

  it('falla si cambia el largo de las filas (el mapeo es posicional)', () => {
    expect(() => filasDesdeJsonMisComprobantes([filaJsonEmitida.slice(0, 40)], 'EMITIDO')).toThrow(/49/);
    expect(() => filasDesdeJsonMisComprobantes([filaJsonRecibida], 'EMITIDO')).toThrow(/49/);
  });
});

/** ZIP mínimo (un archivo, método stored o deflate) para probar el lector sin dependencias. */
function zipDeUnArchivo(nombre: string, contenido: Buffer, comprimir: boolean): Buffer {
  const datos = comprimir ? deflateRawSync(contenido) : contenido;
  const nombreBuf = Buffer.from(nombre, 'utf8');
  const crc = crc32(contenido);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // utf-8
  local.writeUInt16LE(comprimir ? 8 : 0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt32LE(contenido.length, 22);
  local.writeUInt16LE(nombreBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(comprimir ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(datos.length, 20);
  central.writeUInt32LE(contenido.length, 24);
  central.writeUInt16LE(nombreBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length + nombreBuf.length, 12);
  fin.writeUInt32LE(local.length + nombreBuf.length + datos.length, 16);
  return Buffer.concat([local, nombreBuf, datos, central, nombreBuf, fin]);
}
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

describe('extraerCsvDeZip', () => {
  const csv = Buffer.from(`${CAB_EMITIDOS}\n${FILA_EMITIDA}\n`, 'utf8');
  it('lee el único CSV de un ZIP con deflate', () => {
    const r = extraerCsvDeZip(zipDeUnArchivo('comprobantes_consulta_csv_emitidos_1_30712093486_20260916-1212 (montos expresados en pesos).csv', csv, true));
    expect(r.nombre).toMatch(/emitidos/);
    expect(r.contenido).toBe(csv.toString('utf8'));
  });
  it('lee un ZIP sin compresión', () => {
    const r = extraerCsvDeZip(zipDeUnArchivo('x.csv', csv, false));
    expect(r.contenido).toBe(csv.toString('utf8'));
  });
  it('rechaza lo que no es un ZIP', () => {
    expect(() => extraerCsvDeZip(Buffer.from('BL2144953316145 2026-09-16 11:14:11'))).toThrow(/ZIP/);
  });
  it('lee los ZIP reales del relevamiento si están en Docs (opcional)', () => {
    const dir = 'Docs/arca-relevamiento-mcmp/exportados';
    if (!existsSync(dir)) return;
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    for (const f of readdirSync(dir).filter((n: string) => n.endsWith('.zip'))) {
      const r = extraerCsvDeZip(readFileSync(`${dir}/${f}`));
      const parsed = parsearCsvMisComprobantes(r.contenido);
      expect(parsed.filas.length).toBeGreaterThan(0);
      expect(parsed.origen).toBe(f.includes('emitidos') ? 'EMITIDO' : 'RECIBIDO');
      for (const fila of parsed.filas) expect(fila.importeTotal).not.toBeNull();
    }
  });
});

describe('cifrado de la Clave Fiscal', () => {
  const clave = Buffer.alloc(32, 7).toString('hex');
  it('cifra y descifra; el payload no contiene el texto', () => {
    const p = cifrarSecreto('mi clave fiscal', clave);
    expect(p).not.toContain('mi clave');
    expect(p.startsWith('v1:')).toBe(true);
    expect(descifrarSecreto(p, clave)).toBe('mi clave fiscal');
  });
  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    expect(cifrarSecreto('x', clave)).not.toBe(cifrarSecreto('x', clave));
  });
  it('con otra clave o payload alterado falla', () => {
    const p = cifrarSecreto('secreto', clave);
    expect(() => descifrarSecreto(p, Buffer.alloc(32, 9).toString('hex'))).toThrow();
    expect(() => descifrarSecreto(p.slice(0, -2) + 'AA', clave)).toThrow();
  });
  it('exige una clave de 32 bytes en hex', () => {
    expect(() => cifrarSecreto('x', 'corta')).toThrow(/ARCA_PORTAL_SECRET/);
  });
});
