// Reporte personalizado "Gasto por proveedor": compras netas por contraparte.
// Misma cuenta que los totales de Compras (resumirComprobantes): pesificado,
// neto = total − IVA − percepciones − otros tributos, la nota de crédito resta.
// Recibe sólo comprobantes vigentes (el where ya excluye duplicados y anulados).

export type CompraAgrupable = {
  contraparteId: string | null;
  cuitEmisor: string | null; // extraído del documento: agrupa lo que aún no tiene contraparte
  proveedor: string; // razón social de la contraparte o, si no hay, la del documento
  moneda: string;
  tipoCambio: unknown;
  tipoComprobante: string | null;
  total: unknown;
  iva21: unknown;
  iva105: unknown;
  iva27: unknown;
  percepcionesIva: unknown;
  percepcionesIibb: unknown;
  otrosTributos: unknown;
};

/** contraparteId si el proveedor está identificado; si no, cuit (el extraído) o ninguno = "Sin identificar". */
export type FilaGasto = { contraparteId: string | null; cuit: string | null; proveedor: string; cantidad: number; netoArs: number; pct: number };

export type GastoPorProveedor = {
  filas: FilaGasto[];
  resto: { proveedores: number; cantidad: number; netoArs: number } | null;
  total: { cantidad: number; netoArs: number };
  sinTipoCambio: number;
};

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

export function agruparGastoPorProveedor(compras: CompraAgrupable[], topN = 15): GastoPorProveedor {
  const grupos = new Map<string, Omit<FilaGasto, 'pct'>>();
  let sinTipoCambio = 0;
  for (const c of compras) {
    if (c.total == null) continue;
    const tc = c.moneda === 'ARS' ? 1 : n(c.tipoCambio);
    if (!tc) { sinTipoCambio += 1; continue; }
    const signo = c.tipoComprobante?.startsWith('NOTA_CREDITO') ? -1 : 1;
    const neto = signo * tc * (n(c.total) - n(c.iva21) - n(c.iva105) - n(c.iva27)
      - n(c.percepcionesIva) - n(c.percepcionesIibb) - n(c.otrosTributos));
    // Sin contraparte (todavía sin validar): por CUIT del documento, para no
    // mezclar a todos los proveedores pendientes en una sola fila.
    const cuit = c.contraparteId ? null : c.cuitEmisor || null;
    const k = c.contraparteId ? `c:${c.contraparteId}` : cuit ? `cuit:${cuit}` : '';
    const g = grupos.get(k) ?? {
      contraparteId: c.contraparteId,
      cuit,
      proveedor: k ? c.proveedor || `CUIT ${cuit}` : 'Sin identificar',
      cantidad: 0,
      netoArs: 0,
    };
    g.cantidad += 1;
    g.netoArs += neto;
    grupos.set(k, g);
  }
  const todos = [...grupos.values()].sort((a, b) => b.netoArs - a.netoArs);
  const total = {
    cantidad: todos.reduce((s, g) => s + g.cantidad, 0),
    netoArs: r2(todos.reduce((s, g) => s + g.netoArs, 0)),
  };
  const pct = (x: number) => (total.netoArs ? x / total.netoArs : 0);
  const filas = todos.slice(0, topN).map((g) => ({ ...g, netoArs: r2(g.netoArs), pct: pct(g.netoArs) }));
  const cola = todos.slice(topN);
  const resto = cola.length
    ? { proveedores: cola.length, cantidad: cola.reduce((s, g) => s + g.cantidad, 0), netoArs: r2(cola.reduce((s, g) => s + g.netoArs, 0)) }
    : null;
  return { filas, resto, total, sinTipoCambio };
}
