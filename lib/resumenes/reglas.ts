import type { ReglaResumen } from '@prisma/client';
import type { ScopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';
import { normalizarDescriptor } from './matching';
import { ignorarLinea, imputarLinea } from './service';

// Reglas de auto-resolución de líneas de resumen. La primera vez el usuario
// ignora/imputa una línea a mano (con "crear regla"); los resúmenes siguientes
// llegan con esas líneas ya resueltas. IGNORAR aplica a cualquier línea no
// resuelta; IMPUTAR sólo a líneas SIN sugerencia de conciliación (si el
// matching encontró un comprobante candidato, la sugerencia gana — imputar ahí
// duplicaría el gasto) y con importe en pesos.

export type LineaParaRegla = { descriptor: string };
export type ResumenParaRegla = { emisor: string; tipo: string };
export type CondicionReglaResumen = Pick<ReglaResumen, 'descriptorContiene' | 'emisor' | 'tipo'>;

/**
 * Une los grupos de miles: el normalizador convierte el punto en espacio, así
 * que el mismo importe llega como "25 413" o como "25413" según lo imprima el
 * banco (el impuesto al cheque de la ley 25.413 aparece de las dos formas).
 * Sólo se unen los grupos de EXACTAMENTE tres dígitos, que es lo que define un
 * separador de miles: "13 07 26" (una fecha) queda intacto.
 */
function compactarMiles(texto: string): string {
  let previo = '';
  let actual = texto;
  while (actual !== previo) {
    previo = actual;
    actual = actual.replace(/(\d) (\d{3})(?!\d)/g, '$1$2');
  }
  return actual;
}

/** Normaliza y rodea de espacios para poder matchear por palabra completa. */
function normalizarParaRegla(texto: string): string {
  return ` ${compactarMiles(normalizarDescriptor(texto))} `;
}

export function reglaResumenMatchea(regla: CondicionReglaResumen, linea: LineaParaRegla, resumen: ResumenParaRegla): boolean {
  const condicion = normalizarParaRegla(regla.descriptorContiene);
  if (!condicion.trim()) return false; // sin condición: no matchea nunca (evita atrapa-todo)
  // Palabra completa: una condición corta como "iva" no puede matchear "privada".
  if (!normalizarParaRegla(linea.descriptor).includes(condicion)) return false;
  if (regla.emisor && regla.emisor.trim().toLowerCase() !== resumen.emisor.trim().toLowerCase()) return false;
  if (regla.tipo && regla.tipo !== resumen.tipo) return false;
  return true;
}

/**
 * Aplica las reglas activas a las líneas no resueltas de un resumen. Corre al
 * extraer (worker, con el usuario que subió el resumen) y a demanda desde la
 * bandeja. Los guardas del servicio (período cerrado, etc.) hacen que una
 * línea que no puede resolverse quede como estaba, sin frenar al resto.
 */
export async function aplicarReglasResumen(
  db: ScopedDb,
  resumenId: string,
  usuarioId: string | null | undefined,
): Promise<{ ignoradas: number; imputadas: number }> {
  const sinCambios = { ignoradas: 0, imputadas: 0 };
  if (!usuarioId) return sinCambios; // sin usuario no hay autor para auditoría/movimientos
  const resumen = await db.resumen.findFirst({ where: { id: resumenId } });
  if (!resumen) return sinCambios;
  const reglas = await db.reglaResumen.findMany({ where: { activa: true }, orderBy: { createdAt: 'asc' } });
  if (reglas.length === 0) return sinCambios;
  const lineas = await db.resumenLinea.findMany({
    where: { resumenId, estado: { in: ['PENDIENTE', 'SUGERIDA'] } },
    orderBy: { orden: 'asc' },
  });

  // ignorarLinea/imputarLinea sólo usan ctx.db y ctx.usuario.id.
  const ctx = { db, usuario: { id: usuarioId } } as unknown as EmpresaContext;
  let ignoradas = 0;
  let imputadas = 0;
  for (const linea of lineas) {
    const regla = reglas.find((r) => reglaResumenMatchea(r, linea, resumen));
    if (!regla) continue;
    try {
      if (regla.accion === 'IGNORAR') {
        // Si el motivo computa al P&L, el centro viene de la regla (copiado de
        // la línea original al crearla); sin centro, ignorarLinea la rechaza y
        // la línea queda pendiente para resolverla a mano.
        await ignorarLinea(ctx, {
          lineaId: linea.id,
          motivo: regla.motivoIgnorar?.trim() || `Regla: ${regla.nombre}`,
          centroCostoId: regla.centroCostoId,
        });
        ignoradas++;
      } else {
        if (linea.estado === 'SUGERIDA') continue; // la sugerencia de conciliación gana
        if (linea.monto == null) continue; // consumo USD sin pesos: requiere monto manual
        if (!regla.categoriaId) continue;
        const { lineas: distribucion } = await resolverAsignacionDeRegla(db, regla);
        if (distribucion.length === 0) continue;
        await imputarLinea(ctx, { lineaId: linea.id, categoriaId: regla.categoriaId, lineas: distribucion });
        imputadas++;
      }
      await db.resumenLinea.update({ where: { id: linea.id }, data: { reglaAplicada: regla.nombre } });
    } catch {
      // Período cerrado, movimiento ocupado, etc.: la línea queda como estaba.
    }
  }
  return { ignoradas, imputadas };
}

/**
 * Crea una regla a partir de una línea recién resuelta a mano (checkbox
 * "crear regla" de los forms de ignorar/imputar). El descriptor completo de la
 * línea queda como condición; editable después en el maestro. Si ya existe una
 * regla con el mismo nombre, no se duplica.
 */
export async function crearReglaDesdeLinea(
  db: ScopedDb,
  params:
    | { lineaId: string; accion: 'IGNORAR'; motivo: string }
    | { lineaId: string; accion: 'IMPUTAR'; categoriaId: string; centroCostoId: string; clienteId: string | null; proyectoId: string | null },
): Promise<{ creada: boolean; nombre: string }> {
  const linea = await db.resumenLinea.findFirst({ where: { id: params.lineaId } });
  if (!linea) return { creada: false, nombre: '' };
  const nombre = linea.descriptor.trim().slice(0, 60);
  const existente = await db.reglaResumen.findFirst({ where: { nombre } });
  if (existente) return { creada: false, nombre };
  await db.reglaResumen.create({
    data: {
      nombre,
      descriptorContiene: linea.descriptor.trim(),
      accion: params.accion,
      motivoIgnorar: params.accion === 'IGNORAR' ? params.motivo : null,
      categoriaId: params.accion === 'IMPUTAR' ? params.categoriaId : null,
      // IGNORAR con motivo que computa al P&L: hereda el centro que se eligió
      // al ignorar la línea original, así la regla puede auto-resolver.
      centroCostoId: params.accion === 'IMPUTAR' ? params.centroCostoId : linea.centroCostoId ?? null,
      clienteId: params.accion === 'IMPUTAR' ? params.clienteId : null,
      proyectoId: params.accion === 'IMPUTAR' ? params.proyectoId : null,
    } as never,
  });
  return { creada: true, nombre };
}
