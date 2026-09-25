// Proyección de ingresos (Spec F): puro. Separa lo CONFIRMADO (cheques en
// cartera, por su fecha de acreditación) de lo ESTIMADO (saldo de facturas por
// su fecha probable). Sin doble conteo: una factura cubierta por un cheque en
// cartera ya no tiene saldo. Cheques con fecha pasada sin acreditar van a la
// semana en curso (están para depositar).

const DIA_MS = 86_400_000;

export type ItemVentaProyeccion = {
  id: string;
  cliente: string;
  saldoArs: number | null; // null: moneda extranjera sin TC (no se puede sumar)
  fechaProbable: Date | null;
  diasVencida: number; // 0 si no está vencida
};

export type ItemChequeProyeccion = { id: string; cliente: string; montoArs: number; fechaAcreditacion: Date };

export type SemanaProyeccion = { desde: Date; hasta: Date; confirmado: number; estimado: number };

export const TRAMOS_ANTIGUEDAD = ['A vencer', '1–30', '31–60', '61–90', '+90'] as const;
export type FilaAntiguedad = { cliente: string; tramos: number[]; total: number };

export type Proyeccion = {
  kpis: { aCobrar: number; vencido: number; chequesEnCartera: number; proximos30: number };
  vencido: number; // estimado con fecha probable anterior a hoy
  semanas: SemanaProyeccion[];
  despues: { confirmado: number; estimado: number }; // más allá del horizonte
  antiguedad: FilaAntiguedad[];
  sinTipoCambio: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lunes (UTC) de la semana de la fecha. */
export function inicioSemana(f: Date): Date {
  const dia = (f.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate() - dia));
}

/** Tramo de antigüedad (índice de TRAMOS_ANTIGUEDAD) según los días vencida. */
export function tramo(diasVencida: number): number {
  if (diasVencida <= 0) return 0;
  if (diasVencida <= 30) return 1;
  if (diasVencida <= 60) return 2;
  if (diasVencida <= 90) return 3;
  return 4;
}

export function proyectarCobranzas(params: {
  ventas: ItemVentaProyeccion[];
  cheques: ItemChequeProyeccion[];
  hoy: Date;
  semanas?: number;
}): Proyeccion {
  const n = params.semanas ?? 12;
  const inicio = inicioSemana(params.hoy);
  const semanas: SemanaProyeccion[] = Array.from({ length: n }, (_, i) => ({
    desde: new Date(inicio.getTime() + i * 7 * DIA_MS),
    hasta: new Date(inicio.getTime() + (i * 7 + 6) * DIA_MS),
    confirmado: 0,
    estimado: 0,
  }));
  const fin = inicio.getTime() + n * 7 * DIA_MS;
  const limite30 = params.hoy.getTime() + 30 * DIA_MS;
  const idxSemana = (f: Date) => Math.floor((Math.max(f.getTime(), inicio.getTime()) - inicio.getTime()) / (7 * DIA_MS));

  const kpis = { aCobrar: 0, vencido: 0, chequesEnCartera: 0, proximos30: 0 };
  const despues = { confirmado: 0, estimado: 0 };
  let vencido = 0;
  let sinTipoCambio = 0;
  const porCliente = new Map<string, number[]>();

  for (const v of params.ventas) {
    if (v.saldoArs == null) { sinTipoCambio += 1; continue; }
    if (v.saldoArs <= 0) continue;
    kpis.aCobrar += v.saldoArs;
    const tramos = porCliente.get(v.cliente) ?? [0, 0, 0, 0, 0];
    tramos[tramo(v.diasVencida)] += v.saldoArs;
    porCliente.set(v.cliente, tramos);
    if (v.diasVencida > 0 || !v.fechaProbable) {
      kpis.vencido += v.diasVencida > 0 ? v.saldoArs : 0;
      vencido += v.saldoArs;
      continue;
    }
    if (v.fechaProbable.getTime() <= limite30) kpis.proximos30 += v.saldoArs;
    if (v.fechaProbable.getTime() >= fin) despues.estimado += v.saldoArs;
    else semanas[idxSemana(v.fechaProbable)].estimado += v.saldoArs;
  }
  for (const c of params.cheques) {
    kpis.chequesEnCartera += c.montoArs;
    if (c.fechaAcreditacion.getTime() <= limite30) kpis.proximos30 += c.montoArs;
    if (c.fechaAcreditacion.getTime() >= fin) despues.confirmado += c.montoArs;
    else semanas[idxSemana(c.fechaAcreditacion)].confirmado += c.montoArs;
  }

  const antiguedad = [...porCliente.entries()]
    .map(([cliente, tramos]) => ({ cliente, tramos: tramos.map(r2), total: r2(tramos.reduce((s, x) => s + x, 0)) }))
    .sort((a, b) => b.total - a.total);

  return {
    kpis: { aCobrar: r2(kpis.aCobrar), vencido: r2(kpis.vencido), chequesEnCartera: r2(kpis.chequesEnCartera), proximos30: r2(kpis.proximos30) },
    vencido: r2(vencido),
    semanas: semanas.map((s) => ({ ...s, confirmado: r2(s.confirmado), estimado: r2(s.estimado) })),
    despues: { confirmado: r2(despues.confirmado), estimado: r2(despues.estimado) },
    antiguedad,
    sinTipoCambio,
  };
}
