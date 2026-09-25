import { NextResponse } from 'next/server';
import { requireEmpresa, type EmpresaContext } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden } from '@/lib/errors';
import type { Rol } from '@prisma/client';

// Subidas de archivos por RUTA común (route handler), no por server action.
//
// Por qué (25-sep-2026): la regla "React - Leaking Server Functions -
// CVE-2025-55183" del Cloudflare Managed Free Ruleset inspecciona los POST de
// server actions (encabezado Next-Action) y bloquea con 403 algunos PDFs
// legítimos cuyos bytes se parecen al ataque. Una ruta común no lleva ese
// encabezado: la regla no aplica y el WAF queda completo para todo lo demás.
//
// Las rutas responden SIEMPRE JSON; el cliente trata una respuesta que no es
// JSON (página de bloqueo, error del túnel) como "sin respuesta".

/** redirect() de Next (p. ej. requireEmpresa sin sesión -> /login) se propaga como error con digest. */
export function esRedirectNext(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && String((err as { digest?: unknown }).digest ?? '').startsWith('NEXT_REDIRECT'));
}

export async function conEmpresaJson<T>(
  slug: string,
  rol: Rol,
  fn: (ctx: EmpresaContext) => Promise<T>,
): Promise<NextResponse> {
  try {
    const ctx = await requireEmpresa(slug, rol);
    return NextResponse.json(await fn(ctx));
  } catch (err) {
    // Sin sesión: JSON legible (un fetch que sigue el redirect al login no sirve).
    if (esRedirectNext(err)) return NextResponse.json({ error: 'Tu sesión venció: recargá la página e ingresá de nuevo.' }, { status: 401 });
    if (isForbidden(err)) return NextResponse.json({ error: err.message }, { status: 403 });
    if (isDomainError(err)) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error('[subida]', err);
    return NextResponse.json({ error: 'Error inesperado del servidor al recibir el archivo.' }, { status: 500 });
  }
}

export function archivosDe(formData: FormData, campo: string): File[] {
  return formData.getAll(campo).filter((f): f is File => f instanceof File && f.size > 0);
}
