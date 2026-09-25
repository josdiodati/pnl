import type { Prisma } from '@prisma/client';

// Vista Comprobantes: el DOCUMENTO fiscal (de compra, de venta o ambos) en
// todo su ciclo (llega -> se valida -> se asigna), con sus datos fiscales. Es
// el destino de los drill-down: Cobranzas (y más adelante Proveedores) linkean
// acá con filtros que dejan sólo los comprobantes detrás de cada número.
// Se diferencia de Movimientos, que es el libro: sólo lo asignado, de todas
// las fuentes (resúmenes, asientos, ventas) y con su distribución.
//
// Por defecto oculta duplicados y anulados (son ruido: en Kawellu eran 2 de
// cada 3 filas); se ven con su chip de estado.

export const LADOS = ['compras', 'ventas', 'todos'] as const;
export type Lado = (typeof LADOS)[number];
const ORIGENES_POR_LADO: Record<Lado, string[]> = {
  compras: ['COMPROBANTE'],
  ventas: ['VENTA_COMPROBANTE', 'VENTA_MANUAL'],
  todos: ['COMPROBANTE', 'VENTA_COMPROBANTE', 'VENTA_MANUAL'],
};
export function ladoDe(v: string | undefined): Lado {
  return (LADOS as readonly string[]).includes(v ?? '') ? (v as Lado) : 'compras';
}

export type FiltrosComprobantes = {
  lado?: string; // compras (default) | ventas | todos
  // Filtros de cobranza (sólo ventas; ver lib/cobranzas/filtros): se resuelven
  // a ids antes de armar el where.
  cobro?: string;
  tramo?: string;
  semana?: string;
  q?: string;
  desde?: string;
  hasta?: string;
  estado?: string; // '' = vigentes (sin duplicados ni anulados)
  contraparteId?: string;
  categoriaId?: string;
  canal?: string;
  moneda?: string;
  problema?: string; // ver PROBLEMAS
};

export const PROBLEMAS: Record<string, { label: string; where: Prisma.MovimientoWhereInput }> = {
  arca: { label: 'Sin validar en ARCA', where: { arcaEstado: { not: 'VALIDO' }, cae: { not: null } } },
  arcaInvalido: { label: 'ARCA inválido', where: { arcaEstado: 'INVALIDO' } },
  qr: { label: 'QR ilegible o sin QR', where: { qrEstado: { in: ['ILEGIBLE', 'SIN_QR'] } } },
  sinCategoria: { label: 'Sin categoría', where: { categoriaId: null } },
  sinProveedor: { label: 'Proveedor sin identificar', where: { contraparteId: null } },
};

export const ESTADOS_OCULTOS_POR_DEFECTO = ['DUPLICADO', 'ANULADO'] as const;

/** Where sin el filtro de estado (para contar los chips con el resto de los filtros). */
export function buildWhereComprobantesSinEstado(
  f: FiltrosComprobantes,
  opts: { esValidador: boolean; usuarioId: string; ids?: string[] | null },
): Prisma.MovimientoWhereInput {
  const and: Prisma.MovimientoWhereInput[] = [{ origen: { in: ORIGENES_POR_LADO[ladoDe(f.lado)] as never } }];
  if (opts.ids) and.push({ id: { in: opts.ids } });
  if (!opts.esValidador) and.push({ creadoPorId: opts.usuarioId });
  if (f.desde || f.hasta) {
    and.push({
      fechaDevengamiento: {
        ...(f.desde ? { gte: new Date(`${f.desde}T00:00:00Z`) } : {}),
        ...(f.hasta ? { lte: new Date(`${f.hasta}T23:59:59Z`) } : {}),
      },
    });
  }
  if (f.contraparteId) and.push({ contraparteId: f.contraparteId });
  if (f.categoriaId) and.push({ categoriaId: f.categoriaId === 'sin' ? null : f.categoriaId });
  if (f.canal) and.push({ canalIngreso: f.canal });
  if (f.moneda) and.push({ moneda: f.moneda as never });
  if (f.problema && PROBLEMAS[f.problema]) and.push(PROBLEMAS[f.problema].where);
  const q = f.q?.trim();
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    const digitos = q.replace(/\D/g, '');
    and.push({
      OR: [
        { descripcion: contains },
        { numero: contains },
        { cuitEmisor: contains },
        { archivoNombre: contains },
        { contraparte: { razonSocial: contains } },
        { contraparte: { cuit: contains } },
        ...(digitos.length >= 4 && digitos !== q ? [{ cuitEmisor: { contains: digitos } }, { contraparte: { cuit: { contains: digitos } } }] : []),
        // Texto completo del documento (emails, referencias, detalle): el JSON
        // no admite búsqueda insensible, se prueban las variantes de caja.
        ...[q, q.toLowerCase(), q.toUpperCase()].map((v) => ({ extraccionRaw: { path: ['textoDocumento'], string_contains: v } })),
      ],
    });
  }
  return { AND: and };
}

export function buildWhereComprobantes(
  f: FiltrosComprobantes,
  opts: { esValidador: boolean; usuarioId: string; ids?: string[] | null },
): Prisma.MovimientoWhereInput {
  const base = buildWhereComprobantesSinEstado(f, opts);
  const estado: Prisma.MovimientoWhereInput = f.estado
    ? { estado: f.estado as never }
    : { estado: { notIn: [...ESTADOS_OCULTOS_POR_DEFECTO] as never } };
  return { AND: [base, estado] };
}

export type ComprobanteResumible = {
  estado: string;
  moneda: string;
  tipoCambio: unknown;
  tipoComprobante: string | null;
  total: unknown;
  netoGravado: unknown;
  iva21: unknown;
  iva105: unknown;
  iva27: unknown;
  percepcionesIva: unknown;
  percepcionesIibb: unknown;
  otrosTributos: unknown;
  proveedor: string;
};

export type ResumenComprobantes = {
  cantidad: number;
  totalArs: number;
  ivaArs: number; // crédito fiscal: IVA 21 + 10,5 + 27
  percepcionesArs: number;
  netoArs: number; // total − IVA − percepciones − otros tributos
  sinTipoCambio: number;
  topProveedores: { proveedor: string; totalArs: number; cantidad: number }[];
};

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Montos pesificados y con signo de compra (una nota de crédito resta). Anulados y duplicados no suman. */
export function resumirComprobantes(filas: ComprobanteResumible[], topN = 5): ResumenComprobantes {
  const r: ResumenComprobantes = { cantidad: 0, totalArs: 0, ivaArs: 0, percepcionesArs: 0, netoArs: 0, sinTipoCambio: 0, topProveedores: [] };
  const porProveedor = new Map<string, { totalArs: number; cantidad: number }>();
  for (const c of filas) {
    r.cantidad += 1;
    if ((ESTADOS_OCULTOS_POR_DEFECTO as readonly string[]).includes(c.estado) || c.total == null) continue;
    const tc = c.moneda === 'ARS' ? 1 : n(c.tipoCambio);
    if (!tc) { r.sinTipoCambio += 1; continue; }
    const signo = c.tipoComprobante?.startsWith('NOTA_CREDITO') ? -1 : 1;
    const total = signo * n(c.total) * tc;
    const iva = signo * (n(c.iva21) + n(c.iva105) + n(c.iva27)) * tc;
    const perc = signo * (n(c.percepcionesIva) + n(c.percepcionesIibb)) * tc;
    const otros = signo * n(c.otrosTributos) * tc;
    r.totalArs += total;
    r.ivaArs += iva;
    r.percepcionesArs += perc;
    r.netoArs += total - iva - perc - otros;
    const p = porProveedor.get(c.proveedor) ?? { totalArs: 0, cantidad: 0 };
    porProveedor.set(c.proveedor, { totalArs: p.totalArs + total, cantidad: p.cantidad + 1 });
  }
  r.totalArs = r2(r.totalArs); r.ivaArs = r2(r.ivaArs); r.percepcionesArs = r2(r.percepcionesArs); r.netoArs = r2(r.netoArs);
  r.topProveedores = [...porProveedor.entries()]
    .map(([proveedor, v]) => ({ proveedor, totalArs: r2(v.totalArs), cantidad: v.cantidad }))
    .sort((a, b) => b.totalArs - a.totalArs)
    .slice(0, topN);
  return r;
}
