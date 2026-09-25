// Envío de archivos desde el navegador a las rutas de subida (ver
// lib/subidas/ruta.ts). Devuelve undefined si la respuesta no es JSON: algo
// delante de la app (firewall de Cloudflare, túnel) la rechazó. Un corte de red
// tira, como un fetch cualquiera.

export async function postArchivos<T>(url: string, fd: FormData): Promise<T | undefined> {
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return undefined;
  const cuerpo = (await res.json()) as T & { error?: string };
  return cuerpo;
}
