// Resumen mensual de Mis Comprobantes de ARCA: por mes y origen, cuántos
// comprobantes lista ARCA y cuántos ya están cruzados con un comprobante de
// PNL. Alimenta la lista por mes con barra de cumplimiento. Puro.

export type FilaArcaMes = { fechaEmision: Date; origen: 'EMITIDO' | 'RECIBIDO'; movimientoId: string | null };

export type ConteoOrigen = { total: number; cruzados: number };
export type MesArca = { mes: string; emitidos: ConteoOrigen; recibidos: ConteoOrigen; total: number; cruzados: number; faltan: number; pct: number };

export function resumirPorMes(filas: FilaArcaMes[]): MesArca[] {
  const porMes = new Map<string, { emitidos: ConteoOrigen; recibidos: ConteoOrigen }>();
  for (const f of filas) {
    const mes = f.fechaEmision.toISOString().slice(0, 7);
    const m = porMes.get(mes) ?? { emitidos: { total: 0, cruzados: 0 }, recibidos: { total: 0, cruzados: 0 } };
    const c = f.origen === 'EMITIDO' ? m.emitidos : m.recibidos;
    c.total += 1;
    if (f.movimientoId) c.cruzados += 1;
    porMes.set(mes, m);
  }
  return [...porMes.entries()]
    .map(([mes, m]) => {
      const total = m.emitidos.total + m.recibidos.total;
      const cruzados = m.emitidos.cruzados + m.recibidos.cruzados;
      return { mes, ...m, total, cruzados, faltan: total - cruzados, pct: total ? Math.round((cruzados / total) * 100) : 0 };
    })
    .sort((a, b) => b.mes.localeCompare(a.mes));
}
