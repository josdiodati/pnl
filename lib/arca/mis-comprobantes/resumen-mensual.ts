// Resumen mensual de Mis Comprobantes de ARCA: por mes y origen, cuántos
// comprobantes lista ARCA, cuántos ya están cruzados con un comprobante de
// PNL y cuántos se ignoraron (imposibles de conseguir). Alimenta la lista por
// mes con barra de cumplimiento: los ignorados cuentan como resueltos, así el
// período puede cerrar al 100%. Puro.

export type FilaArcaMes = { fechaEmision: Date; origen: 'EMITIDO' | 'RECIBIDO'; movimientoId: string | null; ignoradoAt: Date | null };

export type ConteoOrigen = { total: number; cruzados: number; ignorados: number };
export type MesArca = { mes: string; emitidos: ConteoOrigen; recibidos: ConteoOrigen; total: number; cruzados: number; ignorados: number; faltan: number; pct: number };

export function resumirPorMes(filas: FilaArcaMes[]): MesArca[] {
  const porMes = new Map<string, { emitidos: ConteoOrigen; recibidos: ConteoOrigen }>();
  for (const f of filas) {
    const mes = f.fechaEmision.toISOString().slice(0, 7);
    const m = porMes.get(mes) ?? { emitidos: { total: 0, cruzados: 0, ignorados: 0 }, recibidos: { total: 0, cruzados: 0, ignorados: 0 } };
    const c = f.origen === 'EMITIDO' ? m.emitidos : m.recibidos;
    c.total += 1;
    if (f.movimientoId) c.cruzados += 1;
    else if (f.ignoradoAt) c.ignorados += 1;
    porMes.set(mes, m);
  }
  return [...porMes.entries()]
    .map(([mes, m]) => {
      const total = m.emitidos.total + m.recibidos.total;
      const cruzados = m.emitidos.cruzados + m.recibidos.cruzados;
      const ignorados = m.emitidos.ignorados + m.recibidos.ignorados;
      const resueltos = cruzados + ignorados;
      return { mes, ...m, total, cruzados, ignorados, faltan: total - resueltos, pct: total ? Math.round((resueltos / total) * 100) : 0 };
    })
    .sort((a, b) => b.mes.localeCompare(a.mes));
}
