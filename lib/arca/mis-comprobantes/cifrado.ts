import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifrado de la Clave Fiscal en reposo: AES-256-GCM con la clave del .env
// (ARCA_PORTAL_SECRET, 32 bytes en hex). Formato: v1:<iv>:<tag>:<datos> en
// base64. Sin la clave del .env la base no sirve para recuperar nada.

function claveBinaria(claveHex: string | undefined): Buffer {
  if (!claveHex || !/^[0-9a-fA-F]{64}$/.test(claveHex)) {
    throw new Error('ARCA_PORTAL_SECRET debe ser una clave de 32 bytes en hexadecimal (64 caracteres): generala con `openssl rand -hex 32`.');
  }
  return Buffer.from(claveHex, 'hex');
}

export function cifrarSecreto(texto: string, claveHex: string | undefined = process.env.ARCA_PORTAL_SECRET): string {
  const clave = claveBinaria(claveHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${datos.toString('base64')}`;
}

export function descifrarSecreto(payload: string, claveHex: string | undefined = process.env.ARCA_PORTAL_SECRET): string {
  const clave = claveBinaria(claveHex);
  const [version, iv, tag, datos] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !datos) throw new Error('Secreto cifrado con un formato desconocido.');
  const decipher = createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datos, 'base64')), decipher.final()]).toString('utf8');
}

/** ¿Está configurada la clave de cifrado? (para avisar en Configuración). */
export function cifradoConfigurado(): boolean {
  try {
    claveBinaria(process.env.ARCA_PORTAL_SECRET);
    return true;
  } catch {
    return false;
  }
}
