import { NextResponse, type NextRequest } from 'next/server';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import { importarMisComprobantes } from '@/lib/arca/mis-comprobantes/service';
import { esRedirectNext } from '@/lib/subidas/ruta';

// Importar el CSV/ZIP de Mis Comprobantes: formulario HTML común (POST nativo,
// sin server action; ver lib/subidas/ruta.ts) que vuelve a /arca con ?ok= o
// ?error= (303: el navegador sigue con GET).

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { empresaSlug: string } }) {
  const volver = (clave: 'ok' | 'error', msg: string) =>
    NextResponse.redirect(new URL(`/${params.empresaSlug}/arca?${clave}=${encodeURIComponent(msg)}`, req.url), 303);
  try {
    const ctx = await requireEmpresa(params.empresaSlug, 'VALIDADOR');
    const archivo = (await req.formData()).get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return volver('error', 'Elegí el CSV o el ZIP que bajaste de Mis Comprobantes.');
    if (archivo.size > MAX_BYTES) return volver('error', 'El archivo supera los 20 MB.');
    const r = await importarMisComprobantes(ctx, { contenido: Buffer.from(await archivo.arrayBuffer()), nombreArchivo: archivo.name });
    return volver('ok', `${r.origen === 'EMITIDO' ? 'Emitidos' : 'Recibidos'}: ${r.filas} comprobantes leídos, ${r.nuevos} nuevos, ${r.actualizados} ya conocidos, ${r.cruzados} cruzados con el libro.`);
  } catch (err) {
    if (esRedirectNext(err)) throw err; // sin sesión: Next lleva al login
    if (isDomainError(err) || isForbidden(err) || (err instanceof Error && err.name === 'DomainError')) return volver('error', (err as Error).message);
    throw err;
  }
}
