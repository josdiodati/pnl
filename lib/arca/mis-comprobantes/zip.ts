import { inflateRawSync } from 'node:zlib';

// Lector mínimo de ZIP: el export de Mis Comprobantes es un ZIP con un único
// CSV adentro (método stored o deflate). Sin dependencias: se recorre el
// directorio central y se infla la entrada.

const FIRMA_FIN_CENTRAL = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

export function extraerCsvDeZip(buffer: Buffer): { nombre: string; contenido: string } {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== FIRMA_LOCAL) {
    throw new Error('El archivo no es un ZIP (se esperaba el export de Mis Comprobantes).');
  }
  // Fin del directorio central: última aparición de la firma.
  let fin = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === FIRMA_FIN_CENTRAL) { fin = i; break; }
  }
  if (fin < 0) throw new Error('ZIP inválido: sin directorio central.');
  const cantidad = buffer.readUInt16LE(fin + 10);
  let pos = buffer.readUInt32LE(fin + 16);
  const entradas: { nombre: string; metodo: number; comprimido: number; original: number; offsetLocal: number }[] = [];
  for (let n = 0; n < cantidad; n++) {
    if (buffer.readUInt32LE(pos) !== FIRMA_CENTRAL) throw new Error('ZIP inválido: entrada del directorio central corrupta.');
    const metodo = buffer.readUInt16LE(pos + 10);
    const comprimido = buffer.readUInt32LE(pos + 20);
    const original = buffer.readUInt32LE(pos + 24);
    const largoNombre = buffer.readUInt16LE(pos + 28);
    const largoExtra = buffer.readUInt16LE(pos + 30);
    const largoComentario = buffer.readUInt16LE(pos + 32);
    const offsetLocal = buffer.readUInt32LE(pos + 42);
    const nombre = buffer.subarray(pos + 46, pos + 46 + largoNombre).toString('utf8');
    entradas.push({ nombre, metodo, comprimido, original, offsetLocal });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  const csv = entradas.find((e) => e.nombre.toLowerCase().endsWith('.csv')) ?? entradas[0];
  if (!csv) throw new Error('El ZIP está vacío.');
  const local = csv.offsetLocal;
  if (buffer.readUInt32LE(local) !== FIRMA_LOCAL) throw new Error('ZIP inválido: cabecera local corrupta.');
  const largoNombreLocal = buffer.readUInt16LE(local + 26);
  const largoExtraLocal = buffer.readUInt16LE(local + 28);
  const inicio = local + 30 + largoNombreLocal + largoExtraLocal;
  const datos = buffer.subarray(inicio, inicio + csv.comprimido);
  let contenido: Buffer;
  if (csv.metodo === 0) contenido = datos;
  else if (csv.metodo === 8) contenido = inflateRawSync(datos);
  else throw new Error(`ZIP: método de compresión no soportado (${csv.metodo}).`);
  if (csv.original && contenido.length !== csv.original) throw new Error('ZIP: el tamaño descomprimido no coincide.');
  return { nombre: csv.nombre, contenido: contenido.toString('utf8') };
}
