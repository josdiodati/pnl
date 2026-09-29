import { prisma } from '@/lib/db';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import type { LineaDistribucion } from '@/lib/movimientos/distribucion';
import { normalizarCuit } from '@/lib/checks';
import { writeAudit } from '@/lib/audit';
import { construirReglaDesdeAsignacion, reglasDelCuit, reglaEquivalente, prioridadParaEspecifica, canalRegla } from './desde-asignacion';

// Guarda como regla la imputación que se acaba de cargar. Es best-effort por
// diseño: la asignación del comprobante ya ocurrió y no se deshace porque la
// regla no haya podido guardarse — se devuelve un mensaje y sigue.

export type ParametrosReglaDesdeAsignacion = {
  cuit: string | null;
  razonSocial: string | null;
  categoriaId: string;
  lineas: LineaDistribucion[];
  palabraClave: string | null;
  /** Fuente y usuario elegidos en el atajo ('' o null = cualquiera). Se
   *  validan acá: canal conocido y usuario miembro de la empresa. */
  canal?: string | null;
  cargadoPorId?: string | null;
  nombre: string | null;
};

/** Reglas de imputación vigentes para ese CUIT (puede haber varias), en el
 *  orden en que el motor las evalúa. */
export async function buscarReglasPorCuit(ctx: EmpresaContext, cuit: string | null) {
  if (!cuit) return [];
  const reglas = await ctx.db.reglaAsignacion.findMany();
  return reglasDelCuit(reglas, cuit);
}

/** Resultado para mostrarle al usuario: ok=false va en un aviso aparte (no
 *  mezclado con el "validado/asignado" verde, donde se perdía). */
export type ResultadoRegla = { ok: boolean; mensaje: string };

/** Nombre libre para una plantilla nueva (unique por empresa): agrega " (2)", " (3)"... */
function nombreLibre(base: string, usados: Set<string>): string {
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base} (${i})`)) return `${base} (${i})`;
}

/** Nunca lanza. */
export async function guardarReglaDesdeAsignacion(
  ctx: EmpresaContext,
  p: ParametrosReglaDesdeAsignacion,
): Promise<ResultadoRegla> {
  const falla = (mensaje: string): ResultadoRegla => ({ ok: false, mensaje });
  let plantillaCreadaId: string | null = null;
  try {
    const categoria = await ctx.db.categoria.findFirst({ where: { id: p.categoriaId } });
    if (!categoria) return falla('No se pudo crear la regla: categoría inexistente.');

    const [plantillas, centros] = await Promise.all([
      ctx.db.plantillaDistribucion.findMany({ include: { lineas: true } }),
      ctx.db.centroCosto.findMany({ select: { id: true, nombre: true } }),
    ]);

    const cargadoPorId = p.cargadoPorId?.trim() || null;
    const miembro = cargadoPorId
      ? await prisma.usuarioEmpresa.findFirst({ where: { empresaId: ctx.empresa.id, usuarioId: cargadoPorId }, include: { usuario: { select: { nombre: true, email: true } } } })
      : null;
    if (cargadoPorId && !miembro) return falla('No se creó la regla: el usuario elegido no pertenece a la empresa.');

    const decision = construirReglaDesdeAsignacion({
      cuit: p.cuit,
      razonSocial: p.razonSocial,
      categoriaId: p.categoriaId,
      categoriaNombre: categoria.nombre,
      palabraClave: p.palabraClave,
      canal: canalRegla(p.canal),
      cargadoPorId: miembro?.usuarioId ?? null,
      nombreUsuario: miembro ? miembro.usuario.nombre || miembro.usuario.email : null,
      nombrePropuesto: p.nombre,
      lineas: p.lineas,
      plantillas: plantillas.map((pl) => ({
        id: pl.id,
        lineas: pl.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId ?? null,
          proyectoId: l.proyectoId ?? null,
          porcentaje: Number(l.porcentaje),
        })),
      })),
      nombresCentros: new Map(centros.map((c) => [c.id, c.nombre])),
    });

    if (!decision.crear) return falla(`No se creó la regla: ${decision.motivo}.`);

    // Reparto sin plantilla equivalente: se crea la plantilla y la regla la usa.
    let avisoPlantilla = '';
    if (decision.plantillaNueva) {
      const nombre = nombreLibre(decision.plantillaNueva.nombre, new Set(plantillas.map((pl) => pl.nombre)));
      const lineas = decision.plantillaNueva.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteId: l.clienteId ?? null,
        proyectoId: l.proyectoId ?? null,
        porcentaje: Number(l.porcentaje),
      }));
      const nueva = await ctx.db.plantillaDistribucion.create({ data: { nombre } as never });
      plantillaCreadaId = nueva.id;
      await prisma.plantillaDistribucionLinea.createMany({ data: lineas.map((l) => ({ plantillaId: nueva.id, ...l })) });
      await writeAudit(ctx.db, {
        usuarioId: ctx.usuario.id,
        entidad: 'PlantillaDistribucion',
        entidadId: nueva.id,
        accion: 'CREAR',
        despues: { nombre, lineas, desdeRegla: true },
      });
      decision.regla.distribucionId = nueva.id;
      avisoPlantilla = ` con la distribución nueva «${nombre}» (Maestros → Distribuciones)`;
    }

    // Se pisa SOLO la regla con exactamente las mismas condiciones (CUIT,
    // palabra clave, fuente y usuario). Cualquier otra combinación es una
    // regla nueva, con prioridad para evaluarse antes que las menos específicas.
    const reglas = await ctx.db.reglaAsignacion.findMany();
    const existente = reglaEquivalente(reglas, decision.regla);
    const prioridad = existente ? null : prioridadParaEspecifica(reglas, decision.regla);
    const datos = { ...decision.regla, accion: 'ASIGNAR', ...(prioridad != null ? { prioridad } : {}) };

    if (existente) {
      await ctx.db.reglaAsignacion.update({ where: { id: existente.id }, data: datos as never });
      await writeAudit(ctx.db, {
        usuarioId: ctx.usuario.id,
        entidad: 'ReglaAsignacion',
        entidadId: existente.id,
        accion: 'EDITAR',
        antes: { nombre: existente.nombre, categoriaId: existente.categoriaId, centroCostoId: existente.centroCostoId, distribucionId: existente.distribucionId },
        despues: { ...datos, desdeAsignacion: true },
      });
      plantillaCreadaId = null;
      return { ok: true, mensaje: `regla «${decision.regla.nombre}» actualizada${avisoPlantilla}` };
    }

    const creada = await ctx.db.reglaAsignacion.create({ data: datos as never });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id,
      entidad: 'ReglaAsignacion',
      entidadId: creada.id,
      accion: 'CREAR',
      despues: { ...datos, desdeAsignacion: true },
    });
    plantillaCreadaId = null;
    return {
      ok: true,
      mensaje: prioridad != null
        ? `regla «${decision.regla.nombre}» creada${avisoPlantilla}; se evalúa antes que las reglas más generales de este emisor`
        : `regla «${decision.regla.nombre}» creada${avisoPlantilla}`,
    };
  } catch {
    // Nombre repetido (unique empresaId+nombre) o cualquier otro fallo: la
    // asignación ya está hecha y es lo que importa. Sin regla, la plantilla
    // recién creada no tiene sentido: se deshace.
    if (plantillaCreadaId) await ctx.db.plantillaDistribucion.delete({ where: { id: plantillaCreadaId } }).catch(() => {});
    return falla('No se pudo guardar la regla (revisá que el nombre no esté repetido).');
  }
}
