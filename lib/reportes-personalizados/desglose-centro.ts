import { importesPorLinea } from '@/lib/movimientos/distribucion';
import { baseImponibleFirmada, type MesPnl, type MovimientoPnl, type ReciboPnl } from '@/lib/reportes/pnl';
import type { LineaCentro, Prorrateos } from '@/lib/reportes/prorrateo';

// Desglose de un centro de costo (reporte personalizado "Desglose Shared
// Services"): el listado itemizado detrás de la vista del P&L por un centro.
// Mismas reglas que armarPnl con filtro por centro — misma base neta, mismo
// reparto al centavo de las líneas, mismas exclusiones (impuestos indirectos,
// sin TC, líneas inconsistentes) — así la suma de las filas reproduce el P&L.
// Los prorrateos recibidos van consolidados: una línea por emisor y mes.

export type MovimientoDesglose = MovimientoPnl & { id: string };
export type ReciboDesglose = ReciboPnl & { id: string };

export type SeccionDesglose = 'INGRESOS' | 'EGRESOS' | 'PERSONAL' | 'SIN_CATEGORIA';

export type FilaDesglose = {
  tipo: 'MOVIMIENTO' | 'RECIBO';
  id: string;
  mes: MesPnl;
  seccion: SeccionDesglose;
  /** null en PERSONAL = sueldos y cargas (recibos). */
  categoriaId: string | null;
  /** Neto firmado del documento entero (centavos ARS). */
  neto: number;
  /** % del documento asignado a este centro (suma de sus líneas). */
  porcentaje: number;
  /** Porción de este centro (centavos), idéntica a la del P&L. */
  importe: number;
  /** Las demás líneas del documento (vacío si es 100 % de este centro). */
  otrosCentros: LineaCentro[];
};

export type FilaProrrateoRecibido = {
  emisorId: string;
  mes: MesPnl;
  /** Resultado del mes del centro emisor, antes de repartir. */
  resultadoEmisor: number;
  /** Driver de este centro y total de la base (headcount o facturación). */
  driver: number;
  totalDriver: number;
  importe: number;
};

export type FilaRepartido = { mes: MesPnl; importe: number; sinBase: boolean };

export type Desglose = {
  filas: FilaDesglose[];
  recibidos: FilaProrrateoRecibido[];
  /** Sólo si el centro es prorrateable: lo que repartió a los demás. */
  repartido: FilaRepartido[];
  resultadoAntes: number[];
  resultadoDespues: number[];
};

/** Porción del centro sobre un total firmado; null si las líneas faltan o son inconsistentes. */
function porcionDelCentro(total: number, lineas: LineaCentro[] | undefined, centroId: string) {
  if (!lineas?.length) return null;
  let importes: number[];
  try {
    importes = importesPorLinea(total, lineas);
  } catch {
    return null;
  }
  let importe = 0;
  let porcentaje = 0;
  const otrosCentros: LineaCentro[] = [];
  lineas.forEach((l, i) => {
    if (l.centroCostoId === centroId) {
      importe += importes[i];
      porcentaje += l.porcentaje;
    } else {
      otrosCentros.push({ centroCostoId: l.centroCostoId, porcentaje: l.porcentaje });
    }
  });
  if (porcentaje === 0) return null;
  return { importe, porcentaje: Math.round(porcentaje * 10000) / 10000, otrosCentros };
}

export function desglosarCentro(input: {
  meses: MesPnl[];
  centroId: string;
  movimientos: MovimientoDesglose[];
  recibos: ReciboDesglose[];
  prorrateos?: Prorrateos | null;
  resultadoEmisor?: Map<string, number[]>;
}): Desglose {
  const { meses, centroId } = input;
  const N = meses.length;
  const col = new Map(meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const filas: FilaDesglose[] = [];
  const resultadoAntes = Array<number>(N).fill(0);

  for (const mov of input.movimientos) {
    const c = col.get(`${mov.anio}-${mov.mes}`);
    if (c == null || mov.esImpuestoIndirecto) continue;
    const neto = baseImponibleFirmada(mov);
    if (neto == null) continue;
    const p = porcionDelCentro(neto, mov.lineas, centroId);
    if (!p || p.importe === 0) continue;
    const seccion: SeccionDesglose = !mov.categoriaId
      ? 'SIN_CATEGORIA'
      : mov.esCostoPersonal
        ? 'PERSONAL'
        : mov.tipoCategoria === 'INGRESO'
          ? 'INGRESOS'
          : 'EGRESOS';
    filas.push({ tipo: 'MOVIMIENTO', id: mov.id, mes: meses[c], seccion, categoriaId: mov.categoriaId, neto, ...p });
    resultadoAntes[c] += p.importe;
  }

  for (const r of input.recibos) {
    const c = col.get(`${r.anio}-${r.mes}`);
    if (c == null || r.costoTotalEmpleador == null) continue;
    const neto = -Math.round(r.costoTotalEmpleador * 100);
    const p = porcionDelCentro(neto, r.lineas, centroId);
    if (!p) continue;
    filas.push({ tipo: 'RECIBO', id: r.id, mes: meses[c], seccion: 'PERSONAL', categoriaId: null, neto, ...p });
    resultadoAntes[c] += p.importe;
  }

  const resultadoDespues = [...resultadoAntes];
  const recibidos: FilaProrrateoRecibido[] = [];
  const repartido: FilaRepartido[] = [];
  const pr = input.prorrateos;
  if (pr) {
    for (const [emisorId, valores] of pr.recibidos.get(centroId) ?? []) {
      const base = pr.base.get(emisorId);
      valores.forEach((importe, c) => {
        if (importe === 0) return;
        recibidos.push({
          emisorId,
          mes: meses[c],
          resultadoEmisor: input.resultadoEmisor?.get(emisorId)?.[c] ?? 0,
          driver: base?.porReceptor.get(centroId)?.[c] ?? 0,
          totalDriver: base?.total[c] ?? 0,
          importe,
        });
        resultadoDespues[c] += importe;
      });
    }
    const rep = pr.repartido.get(centroId);
    const sinBase = pr.sinBase.get(centroId);
    if (rep) {
      for (let c = 0; c < N; c++) {
        if (rep[c] === 0 && !sinBase?.[c]) continue;
        repartido.push({ mes: meses[c], importe: rep[c], sinBase: Boolean(sinBase?.[c]) });
        resultadoDespues[c] += rep[c];
      }
    }
  }

  return { filas, recibidos, repartido, resultadoAntes, resultadoDespues };
}

export type GrupoDesglose = { categoriaId: string | null; filas: FilaDesglose[]; subtotal: number };
export type SeccionAgrupada = { seccion: SeccionDesglose; grupos: GrupoDesglose[]; total: number };

const ORDEN_SECCIONES: SeccionDesglose[] = ['INGRESOS', 'EGRESOS', 'PERSONAL', 'SIN_CATEGORIA'];

/**
 * Secciones en el orden del P&L; dentro, una categoría por grupo (sueldos —
 * categoriaId null — primero) y las filas por mes y de mayor a menor importe.
 * `ordenCategorias` fija el orden de los grupos (ej. el del P&L); las que no
 * figuran van al final.
 */
export function agruparDesglose(filas: FilaDesglose[], ordenCategorias: string[] = []): SeccionAgrupada[] {
  const pos = new Map(ordenCategorias.map((id, i) => [id, i]));
  const out: SeccionAgrupada[] = [];
  for (const seccion of ORDEN_SECCIONES) {
    const delaSeccion = filas.filter((f) => f.seccion === seccion);
    if (!delaSeccion.length) continue;
    const porCat = new Map<string | null, FilaDesglose[]>();
    for (const f of delaSeccion) {
      if (!porCat.has(f.categoriaId)) porCat.set(f.categoriaId, []);
      porCat.get(f.categoriaId)!.push(f);
    }
    const grupos = [...porCat.entries()]
      .map(([categoriaId, fs]) => ({
        categoriaId,
        filas: fs.sort(
          (a, b) => a.mes.anio * 12 + a.mes.mes - (b.mes.anio * 12 + b.mes.mes) || Math.abs(b.importe) - Math.abs(a.importe),
        ),
        subtotal: fs.reduce((a, f) => a + f.importe, 0),
      }))
      .sort((a, b) => {
        if (a.categoriaId === null) return -1;
        if (b.categoriaId === null) return 1;
        return (pos.get(a.categoriaId) ?? 1e9) - (pos.get(b.categoriaId) ?? 1e9);
      });
    out.push({ seccion, grupos, total: grupos.reduce((a, g) => a + g.subtotal, 0) });
  }
  return out;
}
