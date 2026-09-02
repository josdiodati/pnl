// Texto plano del documento (capa de texto del PDF vía unpdf). Es la base
// genérica para reglas por palabra clave: cualquier dato que figure en el
// papel (un email, una referencia) es usable aunque el esquema de extracción
// no tenga un campo para él. Para fotos/escaneos la transcripción la aporta
// el LLM (campo textoDocumento del esquema).

const MAX_TEXTO = 4000;

/** Normaliza la transcripción: colapsa espacios por línea, descarta líneas
 *  vacías y trunca. Vacío → null (el campo es opcional, no un string hueco). */
export function prepararTextoDocumento(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpio = texto
    // Caracteres de control (la capa de texto de algunos PDFs los trae):
    // \u0000 ni siquiera entra en el jsonb de Postgres. Se preservan \n y \t.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!limpio) return null;
  return limpio.length > MAX_TEXTO ? limpio.slice(0, MAX_TEXTO) : limpio;
}

/** Capa de texto de un PDF, ya preparada. Best-effort: null si no hay capa
 *  (escaneo) o si unpdf falla. */
export async function extraerTextoPdf(buffer: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(doc, { mergePages: true });
    return prepararTextoDocumento(text);
  } catch {
    return null;
  }
}
