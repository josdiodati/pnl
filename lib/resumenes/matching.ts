// Matching PURO línea de resumen ↔ movimiento existente (anti-duplicados).
// Señales: monto (fuerte: exacto ±$1, en ARS o en moneda origen), fecha
// (±45 días, decae linealmente) y texto (Dice sobre bigramas del descriptor
// vs contraparte + descriptores aprendidos). SUGERIDA = monto + (fecha>0.5 o
// texto>0.4); una sola señal = candidato; nada = sin candidatos.

export type MovimientoCandidato = {
  id: string;
  total: number | null;
  moneda: string;
  fecha: Date | null;
  nombreContraparte: string | null;
  descriptores: string[]; // aprendidos, ya normalizados
  /** Ventas (Spec F): se comparan por SALDO pendiente y sólo contra créditos.
   *  En pesos, un crédito entre 95% y 100% del saldo es "neto de retenciones";
   *  en moneda extranjera, ±5% del saldo pesificado al TC de la factura. */
  venta?: { saldo: number; saldoArs: number | null };
  /** Prefijo del motivo (p. ej. "cobro registrado: Cheque 123"). */
  etiqueta?: string;
};

export type LineaParaMatching = {
  fecha: Date | null;
  descriptor: string;
  monto: number | null; // ARS firmado
  montoOrigen: number | null; // moneda origen firmado
  moneda: string;
};

export function normalizarDescriptor(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramas(s: string): Set<string> {
  const t = s.replace(/ /g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Coeficiente de Dice sobre bigramas (0..1). */
export function similitudTexto(a: string, b: string): number {
  const A = bigramas(normalizarDescriptor(a));
  const B = bigramas(normalizarDescriptor(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const DIAS_VENTANA = 45;
const TOL_CENTAVOS = 100;

const BANDA_VENTA = 0.05;

/** Señal de monto contra una venta: 'exacto', 'retencion', 'tc' o null. */
function señalMontoVenta(linea: LineaParaMatching, mov: MovimientoCandidato): 'exacto' | 'retencion' | 'tc' | null {
  const v = mov.venta!;
  if (linea.monto == null || linea.monto <= 0) return null; // una venta sólo se cobra con un crédito
  const lineaCent = Math.round(linea.monto * 100);
  if (mov.moneda === 'ARS') {
    const saldoCent = Math.round(v.saldo * 100);
    if (Math.abs(lineaCent - saldoCent) <= TOL_CENTAVOS) return 'exacto';
    if (lineaCent < saldoCent && lineaCent >= saldoCent * (1 - BANDA_VENTA)) return 'retencion';
    return null;
  }
  if (linea.montoOrigen != null && linea.moneda === mov.moneda && Math.abs(Math.round(Math.abs(linea.montoOrigen) * 100) - Math.round(v.saldo * 100)) <= TOL_CENTAVOS) {
    return 'exacto';
  }
  if (v.saldoArs != null && v.saldoArs > 0 && Math.abs(linea.monto - v.saldoArs) <= v.saldoArs * BANDA_VENTA) return 'tc';
  return null;
}

function señalMonto(linea: LineaParaMatching, mov: MovimientoCandidato): boolean {
  if (mov.venta) return señalMontoVenta(linea, mov) != null;
  if (mov.total == null) return false;
  const totalCent = Math.round(Math.abs(mov.total) * 100);
  if (linea.monto != null && Math.abs(Math.round(Math.abs(linea.monto) * 100) - totalCent) <= TOL_CENTAVOS) return true;
  // Consumo en moneda extranjera vs comprobante en esa moneda
  if (
    linea.montoOrigen != null &&
    linea.moneda !== 'ARS' &&
    mov.moneda === linea.moneda &&
    Math.abs(Math.round(Math.abs(linea.montoOrigen) * 100) - totalCent) <= TOL_CENTAVOS
  ) {
    return true;
  }
  return false;
}

function señalFecha(linea: LineaParaMatching, mov: MovimientoCandidato): number {
  if (!linea.fecha || !mov.fecha) return 0;
  const dias = Math.abs(linea.fecha.getTime() - mov.fecha.getTime()) / 86400000;
  if (dias > DIAS_VENTANA) return 0;
  return 1 - dias / DIAS_VENTANA;
}

function señalTexto(linea: LineaParaMatching, mov: MovimientoCandidato): number {
  const desc = normalizarDescriptor(linea.descriptor);
  let mejor = mov.nombreContraparte ? similitudTexto(desc, mov.nombreContraparte) : 0;
  for (const aprendido of mov.descriptores) {
    mejor = Math.max(mejor, similitudTexto(desc, aprendido));
  }
  return mejor;
}

export function evaluarLinea(
  linea: LineaParaMatching,
  candidatos: MovimientoCandidato[],
): { estado: 'SUGERIDA' | 'PENDIENTE'; candidatos: { movimientoId: string; score: number; motivo: string }[] } {
  const puntuados = candidatos
    .map((mov) => {
      const monto = señalMonto(linea, mov);
      const fecha = señalFecha(linea, mov);
      const texto = señalTexto(linea, mov);
      const motivos: string[] = [];
      if (monto) {
        const tipo = mov.venta ? señalMontoVenta(linea, mov) : 'exacto';
        motivos.push(tipo === 'retencion' ? 'monto neto de retenciones' : tipo === 'tc' ? 'monto aproximado (tipo de cambio)' : 'monto exacto');
      }
      if (mov.etiqueta) motivos.unshift(mov.etiqueta);
      if (fecha > 0.5) motivos.push('fecha cercana');
      if (texto > 0.4) motivos.push('texto similar');
      // Score: monto pesa 0.6; fecha y texto completan.
      // Un cobro registrado con monto que coincide es mejor evidencia que la venta sola.
      const score = (monto ? 0.6 : 0) + fecha * 0.15 + texto * 0.25 + (monto && mov.etiqueta ? 0.1 : 0);
      return { movimientoId: mov.id, score: Math.round(score * 100) / 100, motivo: motivos.join(' + ') || 'coincidencia débil', señales: { monto, fecha, texto } };
    })
    .filter((c) => c.señales.monto || c.señales.texto > 0.4)
    .sort((a, b) => b.score - a.score)
    // Una venta puede entrar dos veces (por su saldo y por un cobro registrado): queda la mejor.
    .filter((c, i, arr) => arr.findIndex((x) => x.movimientoId === c.movimientoId) === i)
    .slice(0, 5);

  const top = puntuados[0];
  const sugerida = top != null && top.señales.monto && (top.señales.fecha > 0.5 || top.señales.texto > 0.4);
  return {
    estado: sugerida ? 'SUGERIDA' : 'PENDIENTE',
    candidatos: puntuados.map(({ movimientoId, score, motivo }) => ({ movimientoId, score, motivo })),
  };
}
