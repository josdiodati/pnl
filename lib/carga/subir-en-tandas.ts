// Envío de archivos a una server action en tandas (la UploadZone manda de a 5
// para que cada request quede bajo el límite de body de las actions).
//
// Si algo delante de la app rechaza el POST (Cloudflare Access/WAF, un proxy)
// — comprobado el 25-sep-2026: el WAF de Cloudflare bloquea con 403 algunos
// PDFs legítimos por su contenido —
// la respuesta no es un payload RSC y Next resuelve la action con `undefined`
// en vez de tirar. Un corte de red, un 5xx del túnel o un timeout, en cambio,
// sí tiran. Los dos casos se traducen a un error legible con los archivos
// afectados, para que el usuario los reintente, en lugar de romper la página
// o (peor) cortar la subida en silencio.

export const TAMANO_TANDA = 5;

export type ResultadoTanda = { ok: number; errores: string[]; loteId?: string };

export function mensajeSinRespuesta(nombres: string[]): string {
  const lista = nombres.join(', ');
  return `No hubo respuesta del servidor (la subida fue rechazada antes de llegar a PNL, p. ej. por Cloudflare). Reintentá con: ${lista}. Si se repite, avisá con la hora y el archivo.`;
}

export function mensajeBloqueados(nombres: string[]): string {
  const lista = nombres.join(', ');
  return `Cloudflare rechazó ${nombres.length === 1 ? 'este archivo' : 'estos archivos'} por su contenido (su firewall lo confunde con un ataque): ${lista}. El resto se subió bien. Reintentar no sirve: avisá a un administrador con el nombre del archivo.`;
}

export function mensajeErrorEnvio(nombres: string[], err: unknown): string {
  const lista = nombres.join(', ');
  const detalle = err instanceof Error ? err.message : String(err);
  return `La subida se cortó (${detalle}). Reintentá con: ${lista}. Si se repite, avisá con la hora y el archivo.`;
}

export async function subirEnTandas<A extends { name: string }>(
  archivos: A[],
  enviar: (tanda: A[], loteId: string | undefined) => Promise<ResultadoTanda | undefined | null>,
): Promise<ResultadoTanda> {
  const total: ResultadoTanda = { ok: 0, errores: [] };
  // Un drop = un lote: la primera tanda lo crea y las siguientes lo reusan.
  let loteId: string | undefined;
  const bloqueados: string[] = [];
  for (let i = 0; i < archivos.length; i += TAMANO_TANDA) {
    const tanda = archivos.slice(i, i + TAMANO_TANDA);
    let r: ResultadoTanda | undefined | null;
    try {
      r = await enviar(tanda, loteId);
    } catch (err) {
      total.errores.push(mensajeErrorEnvio(archivos.slice(i).map((f) => f.name), err));
      break;
    }
    if (!r) {
      // Sin respuesta. El firewall de Cloudflare rechaza ciertos PDFs por su
      // contenido y se lleva puesta la tanda entera: se reintenta de a uno
      // para que entre el resto y quede nombrado sólo lo bloqueado.
      const bloqueadosTanda: string[] = [];
      let pasaron = 0;
      for (const archivo of tanda) {
        let ri: ResultadoTanda | undefined | null = null;
        try {
          ri = await enviar([archivo], loteId);
        } catch {
          ri = null;
        }
        if (!ri) {
          bloqueadosTanda.push(archivo.name);
          continue;
        }
        pasaron++;
        loteId = loteId ?? ri.loteId;
        total.ok += ri.ok;
        total.errores.push(...ri.errores);
      }
      if (pasaron === 0) {
        // Nada pasa ni de a uno: no es un archivo, es el acceso (sesión
        // vencida, túnel caído). Se corta y se nombra todo lo que falta.
        total.errores.push(mensajeSinRespuesta(archivos.slice(i).map((f) => f.name)));
        break;
      }
      bloqueados.push(...bloqueadosTanda);
      continue;
    }
    loteId = loteId ?? r.loteId;
    total.ok += r.ok;
    total.errores.push(...r.errores);
  }
  if (bloqueados.length) total.errores.push(mensajeBloqueados(bloqueados));
  if (loteId) total.loteId = loteId;
  return total;
}
