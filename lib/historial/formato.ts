import { formatMoney, formatFecha } from '@/lib/format';
import { ESTADO_LABEL } from '@/lib/movimientos/estados';

// Formateo puro del historial de un comprobante: traduce cada AuditLog
// (accion + antes/despues) a una línea legible con actor y detalles. Tolera
// los payloads viejos (menos ricos) mostrando lo que haya, sin inventar.

export type EventoCrudo = {
  id: string;
  accion: string;
  usuarioId: string | null;
  antes: unknown;
  despues: unknown;
  createdAt: Date;
};

export type Referencias = {
  usuarios?: Map<string, string>;
  contrapartes?: Map<string, string>;
  categorias?: Map<string, string>;
  centros?: Map<string, string>;
  clientes?: Map<string, string>;
  proyectos?: Map<string, string>;
};

export type EventoFormateado = {
  id: string;
  fecha: Date;
  actor: string;
  titulo: string;
  detalles: string[];
  /** Payload crudo para el desplegable técnico; null si no aporta nada. */
  tecnico: unknown;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function nombreDe(mapa: Map<string, string> | undefined, id: unknown): string {
  if (id == null || id === '') return '—';
  return mapa?.get(String(id)) ?? String(id);
}

function estadoLegible(estado: unknown): string {
  const s = str(estado);
  if (!s) return '—';
  return (ESTADO_LABEL as Record<string, string>)[s] ?? s;
}

// ---------- Diff de snapshots (VALIDAR / ASIGNAR) ----------

const CAMPOS_IMPORTE = new Set([
  'total', 'netoGravado', 'iva21', 'iva105', 'iva27',
  'percepcionesIva', 'percepcionesIibb', 'otrosTributos', 'noGravadoExento', 'tipoCambio',
]);

const CAMPOS_DIFF: [campo: string, etiqueta: string][] = [
  ['fechaDevengamiento', 'fecha'],
  ['contraparteId', 'contraparte'],
  ['categoriaId', 'categoría'],
  ['descripcion', 'descripción'],
  ['origen', 'compra/venta'],
  ['moneda', 'moneda'],
  ['tipoCambio', 'tipo de cambio'],
  ['tipoComprobante', 'tipo de comprobante'],
  ['puntoVenta', 'punto de venta'],
  ['numero', 'número'],
  ['cae', 'CAE'],
  ['cuitEmisor', 'CUIT emisor'],
  ['total', 'total'],
  ['netoGravado', 'neto gravado'],
  ['iva21', 'IVA 21%'],
  ['iva105', 'IVA 10,5%'],
  ['iva27', 'IVA 27%'],
  ['percepcionesIva', 'percepciones IVA'],
  ['percepcionesIibb', 'percepciones IIBB'],
  ['otrosTributos', 'otros tributos'],
  ['noGravadoExento', 'no gravado/exento'],
];

function valorLegible(campo: string, v: unknown, refs: Referencias): string {
  if (v == null || v === '') return '—';
  if (campo === 'contraparteId') return nombreDe(refs.contrapartes, v);
  if (campo === 'categoriaId') return nombreDe(refs.categorias, v);
  if (campo === 'fechaDevengamiento') return formatFecha(String(v));
  if (campo === 'origen') return String(v).startsWith('VENTA') ? 'venta' : 'compra';
  if (CAMPOS_IMPORTE.has(campo)) return formatMoney(String(v));
  return String(v);
}

/** Igualdad tolerante a la serialización: Decimal viaja como string ("1200.00"
 *  vs 1200) y las fechas como ISO; se comparan normalizados. */
function mismoValor(campo: string, a: unknown, b: unknown): boolean {
  if ((a == null || a === '') && (b == null || b === '')) return true;
  if (CAMPOS_IMPORTE.has(campo)) return Number(a) === Number(b);
  if (campo === 'fechaDevengamiento') {
    return String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10);
  }
  return String(a ?? '') === String(b ?? '');
}

function diffCampos(antes: Obj, despues: Obj, refs: Referencias): string[] {
  const out: string[] = [];
  for (const [campo, etiqueta] of CAMPOS_DIFF) {
    if (!(campo in antes) && !(campo in despues)) continue;
    if (mismoValor(campo, antes[campo], despues[campo])) continue;
    out.push(`${etiqueta}: ${valorLegible(campo, antes[campo], refs)} → ${valorLegible(campo, despues[campo], refs)}`);
  }
  return out;
}

// ---------- Líneas de distribución y reglas ----------

function resumenLineas(lineas: unknown, refs: Referencias): string | null {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  const partes = lineas.map((l) => {
    const o = obj(l);
    const centro = nombreDe(refs.centros, o.centroCostoId);
    const cliente = o.clienteId ? ` / ${nombreDe(refs.clientes, o.clienteId)}` : '';
    const proyecto = o.proyectoId ? ` / ${nombreDe(refs.proyectos, o.proyectoId)}` : '';
    return `${Number(o.porcentaje)}% ${centro}${cliente}${proyecto}`;
  });
  return `Distribución: ${partes.join(' + ')}`;
}

const CONDICION_LABEL: Record<string, string> = {
  CUIT: 'CUIT',
  CANAL: 'canal',
  PALABRA_CLAVE: 'palabra clave',
  CARGADO_POR: 'cargado por',
};

/** `regla` viene como string (eventos viejos) o como objeto enriquecido
 *  { nombre, condiciones, categoriaId } (eventos nuevos). */
function detalleRegla(regla: unknown, refs: Referencias): string[] {
  if (regla == null) return [];
  if (typeof regla === 'string') return [`Regla aplicada: «${regla}»`];
  const r = obj(regla);
  const out: string[] = [];
  const condiciones = Array.isArray(r.condiciones)
    ? r.condiciones.map((c) => {
        const o = obj(c);
        const tipo = CONDICION_LABEL[String(o.tipo)] ?? String(o.tipo);
        const valor = o.tipo === 'CARGADO_POR' ? nombreDe(refs.usuarios, o.valor) : o.tipo === 'PALABRA_CLAVE' ? `«${String(o.valor)}»` : String(o.valor);
        return `${tipo} ${valor}`;
      })
    : [];
  out.push(`Regla aplicada: «${str(r.nombre) ?? '?'}»${condiciones.length ? ` — matcheó por ${condiciones.join(' + ')}` : ''}`);
  if (r.categoriaId) out.push(`La regla imputó la categoría ${nombreDe(refs.categorias, r.categoriaId)}`);
  return out;
}

// ---------- Formateo por acción ----------

function formatear(e: EventoCrudo, refs: Referencias): Omit<EventoFormateado, 'id' | 'fecha' | 'actor'> {
  const d = obj(e.despues);
  const a = obj(e.antes);
  const detalles: string[] = [];

  switch (e.accion) {
    case 'CREAR':
    case 'CREAR_Y_VALIDAR': {
      const desdeResumen = obj(d.desdeResumen);
      if (d.origen === 'RESUMEN' || str(desdeResumen.resumenId)) {
        if (str(desdeResumen.descriptor)) detalles.push(`Línea del resumen: «${str(desdeResumen.descriptor)}»`);
        if (d.total != null) detalles.push(`Total: ${formatMoney(String(d.total))}`);
        if (str(d.categoria)) detalles.push(`Categoría: ${str(d.categoria)}`);
        return { titulo: 'Creado al imputar una línea de resumen (nace asignado)', detalles, tecnico: e.despues };
      }
      if (d.origen === 'ASIENTO_MANUAL' || d.origen === 'VENTA_MANUAL') {
        if (d.total != null) detalles.push(`Total: ${formatMoney(String(d.total))}`);
        if (d.categoriaId) detalles.push(`Categoría: ${nombreDe(refs.categorias, d.categoriaId)}`);
        const lin = resumenLineas(d.lineas, refs);
        if (lin) detalles.push(lin);
        return {
          titulo: d.origen === 'VENTA_MANUAL' ? 'Venta manual creada' : 'Asiento manual creado',
          detalles,
          tecnico: e.despues,
        };
      }
      if (str(d.archivo)) detalles.push(`Archivo: ${str(d.archivo)}`);
      return { titulo: `Comprobante ingresado vía ${str(d.canal) ?? '—'}`, detalles, tecnico: null };
    }

    case 'EXTRAER': {
      if (str(d.contraparte)) detalles.push(`Contraparte detectada: ${str(d.contraparte)}`);
      const revisar = obj(d.camposRevisar);
      const claves = Object.keys(revisar);
      if (claves.length) detalles.push(`Campos marcados para revisar: ${claves.join(', ')}`);
      if (Array.isArray(d.duplicados) && d.duplicados.length) {
        detalles.push(`Posible duplicado de ${d.duplicados.length} comprobante(s) ya cargado(s)`);
      }
      const auto = obj(d.autovalidacion);
      if (auto.apto === false && Array.isArray(auto.motivos) && auto.motivos.length) {
        detalles.push(`No se autovalidó: ${auto.motivos.join(', ')}`);
      }
      return { titulo: `Extracción OCR completada → ${estadoLegible(d.estado)}`, detalles, tecnico: e.despues };
    }

    case 'AUTO_VALIDAR':
    case 'AUTO_ASIGNAR': {
      if (Array.isArray(d.chequeos) && d.chequeos.length) {
        detalles.push(`Chequeos aprobados: ${d.chequeos.join(', ')}`);
      }
      detalles.push(...detalleRegla(d.regla, refs));
      const lin = resumenLineas(d.lineas, refs);
      if (lin) detalles.push(lin);
      return {
        titulo: e.accion === 'AUTO_ASIGNAR' ? 'Autovalidado y asignado por regla' : 'Autovalidado',
        detalles,
        tecnico: e.despues,
      };
    }

    case 'AUTO_OBSERVAR': {
      if (d.regla != null) detalles.push(...detalleRegla(d.regla, refs));
      if (str(d.motivo)) detalles.push(`Motivo: ${str(d.motivo)}`);
      if (str(d.detalle)) detalles.push(`Detalle de ARCA: ${str(d.detalle)}`);
      const desde = str(a.estado);
      return {
        titulo: `Observado automáticamente${desde ? ` (estaba ${estadoLegible(desde)})` : ''}`,
        detalles,
        tecnico: e.despues,
      };
    }

    case 'AUTO_DUPLICADO': {
      const como = str(d.confirmadoPor);
      if (como === 'HASH_ARCHIVO') {
        detalles.push('Es exactamente el mismo archivo (hash idéntico) que otro comprobante ya ingresado');
      } else if (como === 'QR') {
        detalles.push('Mismo CUIT + tipo + punto de venta + número que otro comprobante, con identidad confirmada por el QR');
      } else if (como === 'ARCA') {
        detalles.push('Mismo CUIT + tipo + punto de venta + número que otro comprobante, confirmado por la constatación en ARCA');
      }
      if (Array.isArray(d.duplicados) && d.duplicados.length) {
        detalles.push(`Comprobante(s) original(es): ${d.duplicados.map(String).join(', ')}`);
      }
      return { titulo: 'Apartado como duplicado', detalles, tecnico: e.despues };
    }

    case 'ARCA_CONSTATAR': {
      if (str(d.detalle)) detalles.push(`Detalle: ${str(d.detalle)}`);
      return { titulo: `Constatación ARCA: ${str(d.estado) ?? '—'}`, detalles, tecnico: null };
    }

    case 'ERROR_PROCESAMIENTO':
      return { titulo: 'Error de procesamiento OCR', detalles: str(d.error) ? [String(d.error)] : [], tecnico: e.despues };

    case 'VALIDAR': {
      const cambios = diffCampos(a, d, refs);
      if (cambios.length) detalles.push(`Cambios sobre lo extraído: ${cambios.join('; ')}`);
      else detalles.push('Sin cambios sobre los datos extraídos');
      if (d.arcaInvalidoConfirmadoPorValidador) {
        detalles.push('El validador confirmó explícitamente un comprobante que ARCA marca INVÁLIDO');
      }
      if (d.overrideNoFiscal) {
        detalles.push(`Override no fiscal/extranjero: ${str(d.overrideNoFiscalMotivo) ?? 'sin motivo'}`);
      }
      if (d.categoriaId && mismoValor('categoriaId', a.categoriaId, d.categoriaId)) {
        detalles.push(`Categoría: ${nombreDe(refs.categorias, d.categoriaId)}`);
      }
      const lin = resumenLineas(d.lineas, refs);
      if (lin) detalles.push(lin);
      return {
        titulo: d.estado === 'ASIGNADO' ? 'Validado y asignado en la misma pantalla' : 'Validado',
        detalles,
        tecnico: e.despues,
      };
    }

    case 'ASIGNAR': {
      if (d.categoriaId) detalles.push(`Categoría: ${nombreDe(refs.categorias, d.categoriaId)}`);
      const lin = resumenLineas(d.lineas, refs);
      if (lin) detalles.push(lin);
      return { titulo: 'Asignado', detalles, tecnico: e.despues };
    }

    case 'OBSERVAR':
      return { titulo: 'Observado (apartado del flujo)', detalles: str(d.nota) ? [`Nota: ${str(d.nota)}`] : [], tecnico: null };

    case 'VOLVER_A_PENDIENTE': {
      if (str(d.nota)) detalles.push(`Nota: ${str(d.nota)}`);
      if (d.reprocesa) detalles.push('Se re-encoló la extracción OCR (el archivo se reprocesa desde cero)');
      return {
        titulo: `Devuelto a ${estadoLegible(d.estado)} (estaba ${estadoLegible(a.estado)})`,
        detalles,
        tecnico: null,
      };
    }

    case 'ANULAR': {
      if (str(d.motivo)) detalles.push(`Motivo: ${str(d.motivo)}`);
      const desdeResumen = obj(d.desdeResumen);
      if (str(desdeResumen.resumenId)) detalles.push('La anulación vino de deshacer la imputación en el resumen');
      return { titulo: 'Anulado', detalles, tecnico: null };
    }

    case 'ELIMINAR_DUPLICADO':
      return {
        titulo: 'Duplicado borrado físicamente',
        detalles: str(a.archivoNombre) ? [`Archivo: ${str(a.archivoNombre)}`] : [],
        tecnico: e.antes,
      };

    case 'REINTENTAR_EXTRACCION':
      return { titulo: 'Reintento de extracción OCR', detalles, tecnico: null };

    case 'CARGAR_A_MANO':
      return { titulo: 'Pasado a carga manual (el OCR había fallado)', detalles, tecnico: null };

    case 'VINCULAR_EMPLEADO':
      return {
        titulo: `Vinculado al empleado ${str(d.empleado) ?? ''}`.trim(),
        detalles: d.monto != null ? [`Monto: ${formatMoney(String(d.monto))}`] : [],
        tecnico: null,
      };

    case 'DESVINCULAR_EMPLEADO':
      return { titulo: 'Desvinculado del empleado', detalles, tecnico: null };

    default:
      return { titulo: e.accion, detalles, tecnico: e.despues ?? e.antes ?? null };
  }
}

export function formatearHistorial(eventos: EventoCrudo[], refs: Referencias = {}): EventoFormateado[] {
  return eventos.map((e) => {
    const actor = e.usuarioId ? (refs.usuarios?.get(e.usuarioId) ?? 'Usuario') : 'Sistema';
    return { id: e.id, fecha: e.createdAt, actor, ...formatear(e, refs) };
  });
}
