import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { writeAudit } from '@/lib/audit';
import { ORIGENES_VENTA } from '@/lib/ventas/query';
import { esCobrable } from './estado';
import { calcularReparto, sugerenciaRetencion } from './reparto';
import { cargarVentas, eliminarCobroGrupo, facturasParaReparto, persistirReparto } from './service';
import { INSTRUMENTOS_BANCARIOS } from './labels';

// Etapa 3 (Spec F): el resumen del banco CONFIRMA cobros en vez de descubrirlos.
//
// - Conciliar un crédito contra una venta con un cobro registrado sin confirmar
//   cuyo monto coincide: se confirma ese cobro (cheque → ACREDITADO) y la línea
//   se vincula a todas sus ventas.
// - Si no hay cobro registrado, la línea crea sus propios cobros (origen
//   RESUMEN) repartidos FIFO entre las ventas vinculadas; en pesos, un faltante
//   ≤ 5% se cierra como retención; en USD la cotización es la implícita y se
//   genera el ajuste de cambio.
// - Cada cambio de la línea (conciliar, desvincular, deshacer) recalcula: los
//   cobros automáticos se borran y se recrean; los manuales vuelven a "sin
//   confirmar" si la línea ya no los respalda.

const TOLERANCIA = 1; // pesos

type Linea = { id: string; resumenId: string; fecha: Date | null; monto: unknown; descriptor: string };

function pesosDeCobro(c: { monto: unknown; moneda: string; tipoCambio: unknown }): number {
  const monto = Number(c.monto);
  return c.moneda === 'ARS' ? monto : monto * (c.tipoCambio != null ? Number(c.tipoCambio) : 1);
}

/**
 * Busca un cobro registrado (o un grupo de instrumentos bancarios del mismo
 * recibo) sin confirmar, aplicado a la venta, cuyo monto coincide con el
 * crédito, y lo confirma con la línea. Devuelve true si confirmó alguno.
 */
export async function confirmarCobroRegistrado(ctx: EmpresaContext, linea: Linea, ventaId: string): Promise<boolean> {
  const monto = linea.monto != null ? Number(linea.monto) : null;
  if (monto == null || monto <= 0) return false;
  const pendientes = await ctx.db.cobro.findMany({
    where: {
      origen: 'MANUAL',
      resumenLineaId: null,
      estado: { not: 'RECHAZADO' },
      instrumento: { in: [...INSTRUMENTOS_BANCARIOS] as never },
      aplicaciones: { some: { movimientoId: ventaId } },
    },
    include: { aplicaciones: true },
    orderBy: { fechaAcreditacion: 'asc' },
  });
  let elegidos = pendientes.filter((c) => Math.abs(pesosDeCobro(c) - monto) <= TOLERANCIA).slice(0, 1);
  if (elegidos.length === 0) {
    // Depósito de varios cheques del mismo recibo en una sola línea.
    const porGrupo = new Map<string, typeof pendientes>();
    for (const c of pendientes) porGrupo.set(c.grupo, [...(porGrupo.get(c.grupo) ?? []), c]);
    for (const grupo of porGrupo.values()) {
      if (grupo.length > 1 && Math.abs(grupo.reduce((s, c) => s + pesosDeCobro(c), 0) - monto) <= TOLERANCIA) {
        elegidos = grupo;
        break;
      }
    }
  }
  if (elegidos.length === 0) return false;

  const fecha = linea.fecha ?? undefined;
  for (const c of elegidos) {
    await ctx.db.cobro.update({
      where: { id: c.id },
      data: { resumenLineaId: linea.id, estado: 'ACREDITADO', ...(fecha ? { fechaAcreditacion: fecha } : {}) },
    });
  }
  const ventas = [...new Set(elegidos.flatMap((c) => c.aplicaciones.map((a) => a.movimientoId)))];
  const existentes = new Set((await ctx.db.resumenLineaVinculo.findMany({ where: { lineaId: linea.id } })).map((v) => v.movimientoId));
  for (const v of ventas) {
    if (!existentes.has(v)) await ctx.db.resumenLineaVinculo.create({ data: { lineaId: linea.id, movimientoId: v } });
  }
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Cobro',
    entidadId: elegidos[0].grupo,
    accion: 'COBRO_CONFIRMAR_RESUMEN',
    despues: { lineaId: linea.id, resumenId: linea.resumenId, descriptor: linea.descriptor, cobros: elegidos.map((c) => c.id), ventas },
  });
  return true;
}

/** Recalcula los cobros que dependen de una línea de resumen (idempotente). */
export async function sincronizarCobrosDeLinea(ctx: EmpresaContext, lineaId: string): Promise<void> {
  const linea = await ctx.db.resumenLinea.findFirst({
    where: { id: lineaId },
    include: { vinculos: true, cobros: { include: { aplicaciones: true } } },
  });
  if (!linea) return;
  const vinculadas = new Set(linea.vinculos.map((v) => v.movimientoId));
  const conciliada = linea.estado === 'CONCILIADA';

  // 1. Manuales: siguen confirmados sólo si la línea sigue conciliada con todas sus ventas.
  const manualesVigentes: typeof linea.cobros = [];
  for (const c of linea.cobros.filter((x) => x.origen === 'MANUAL')) {
    if (conciliada && c.aplicaciones.every((a) => vinculadas.has(a.movimientoId))) {
      manualesVigentes.push(c);
      continue;
    }
    const esCheque = c.instrumento === 'CHEQUE' || c.instrumento === 'ECHEQ';
    await ctx.db.cobro.update({ where: { id: c.id }, data: { resumenLineaId: null, ...(esCheque ? { estado: 'EN_CARTERA' } : {}) } });
    await writeAudit(ctx.db, {
      usuarioId: ctx.usuario.id, entidad: 'Cobro', entidadId: c.grupo, accion: 'COBRO_DESCONFIRMAR_RESUMEN',
      antes: { cobroId: c.id, lineaId: linea.id },
    });
  }

  // 2. Automáticos: se borran siempre y se recrean con lo vigente.
  const gruposAuto = [...new Set(linea.cobros.filter((x) => x.origen === 'RESUMEN').map((x) => x.grupo))];
  for (const g of gruposAuto) await eliminarCobroGrupo(ctx, g, { desdeResumen: true });

  const monto = linea.monto != null ? Number(linea.monto) : null;
  if (!conciliada || monto == null || monto <= 0 || vinculadas.size === 0) return;

  let restante = Math.round((monto - manualesVigentes.reduce((s, c) => s + pesosDeCobro(c), 0)) * 100) / 100;
  if (restante <= 0.01) return;

  const candidatas = await ctx.db.movimiento.findMany({
    where: { id: { in: [...vinculadas] }, origen: { in: [...ORIGENES_VENTA] } },
    select: { id: true },
  });
  if (candidatas.length === 0) return;
  const ventas = await cargarVentas(ctx.db, candidatas.map((v) => v.id));
  const facturas = facturasParaReparto(ventas).filter((f) => esCobrable(f.cobrable) && f.saldo > 0);
  if (facturas.length === 0) return;

  const fecha = linea.fecha ?? new Date();
  const pesos = facturas.filter((f) => f.moneda === 'ARS');
  const extranjeras = facturas.filter((f) => f.moneda !== 'ARS');
  const grupos: { facturas: typeof facturas; monto: number }[] = [];
  if (pesos.length) {
    const saldo = pesos.reduce((s, f) => s + f.saldo, 0);
    const aplicar = Math.min(restante, Math.round(saldo * 100) / 100);
    grupos.push({ facturas: pesos, monto: aplicar });
    restante = Math.round((restante - aplicar) * 100) / 100;
  }
  if (extranjeras.length && restante > 0.01) {
    const moneda = extranjeras[0].moneda;
    grupos.push({ facturas: extranjeras.filter((f) => f.moneda === moneda), monto: restante });
  }

  for (const g of grupos) {
    if (g.monto <= 0.01) continue;
    const saldo = g.facturas.reduce((s, f) => s + f.saldo, 0);
    const retener = g.facturas[0].moneda === 'ARS' && sugerenciaRetencion(saldo, g.monto, 'ARS').sugerir;
    const reparto = calcularReparto({
      facturas: g.facturas,
      instrumentos: [{ instrumento: 'TRANSFERENCIA', monto: g.monto, moneda: 'ARS', fecha, fechaAcreditacion: fecha }],
      cerrarDiferenciaComoRetencion: retener,
    });
    const idsGrupo = new Set(g.facturas.map((f) => f.id));
    await persistirReparto(ctx, {
      ventas: ventas.filter((v) => idsGrupo.has(v.id)),
      reparto,
      origen: 'RESUMEN',
      resumenLineaId: linea.id,
      nota: `Resumen: ${linea.descriptor}`.slice(0, 300),
    });
  }
}
