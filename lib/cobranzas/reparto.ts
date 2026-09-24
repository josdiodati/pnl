import { DomainError } from '@/lib/errors';

// Reparto de un cobro (uno o varios instrumentos) entre una o varias facturas
// de la misma moneda. Puro. FIFO: facturas por fecha ascendente; instrumentos
// bancarios primero y retenciones/NC al final. Todo se calcula en centavos
// enteros para que los pesos de cada instrumento cierren exactos.
//
// Moneda extranjera: si las facturas son USD y entra un instrumento en pesos,
// la cotización es la informada o, si no hay, la implícita (pesos / saldo USD
// que queda por cubrir: se asume que el cobro cancela todo). Cada aplicación
// lleva su diferencia de cambio contra el TC de la factura, que el servicio
// convierte en un asiento de ajuste.

export const UMBRAL_RETENCION = 0.05;

export type FacturaReparto = {
  id: string;
  fecha: Date | null;
  saldo: number; // moneda de la factura
  moneda: string;
  tcFactura: number | null; // pesos por unidad (1 en ARS)
};

export type InstrumentoReparto = {
  instrumento: string; // InstrumentoCobro
  monto: number;
  moneda: string;
  fecha: Date;
  fechaAcreditacion: Date;
  numero?: string | null;
  banco?: string | null;
};

export type AplicacionReparto = { movimientoId: string; importe: number; importeArs: number; diferenciaCambioArs: number };

export type InstrumentoRepartido = InstrumentoReparto & { aplicaciones: AplicacionReparto[] };

export type ResultadoReparto = {
  instrumentos: InstrumentoRepartido[];
  /** Saldo que queda sin cubrir (moneda de las facturas). */
  faltante: number;
  /** Cotización usada para instrumentos en pesos sobre facturas en moneda extranjera. */
  cotizacion: number | null;
  moneda: string;
};

const NO_BANCARIOS = new Set(['RETENCION', 'NOTA_CREDITO']);
const aCent = (n: number) => Math.round(n * 100);
const deCent = (c: number) => c / 100;

export function sugerenciaRetencion(saldoTotal: number, totalInstrumentos: number, moneda: string): { sugerir: boolean; monto: number } {
  const faltante = Math.max(0, aCent(saldoTotal) - aCent(totalInstrumentos));
  const sugerir = moneda === 'ARS' && faltante > 1 && faltante <= aCent(saldoTotal) * UMBRAL_RETENCION;
  return { sugerir, monto: deCent(faltante) };
}

export function calcularReparto(params: {
  facturas: FacturaReparto[];
  instrumentos: InstrumentoReparto[];
  cotizacion?: number | null;
  cerrarDiferenciaComoRetencion?: boolean;
}): ResultadoReparto {
  const { facturas } = params;
  if (facturas.length === 0) throw new DomainError('Elegí al menos una factura.');
  const moneda = facturas[0].moneda;
  if (facturas.some((f) => f.moneda !== moneda)) throw new DomainError('Todas las facturas de un cobro deben ser de la misma moneda.');
  const instrumentosIn = params.instrumentos.filter((i) => i.monto != null);
  if (instrumentosIn.length === 0 || instrumentosIn.some((i) => !(i.monto > 0))) {
    throw new DomainError('Cada instrumento necesita un monto mayor a cero.');
  }
  const extranjera = moneda !== 'ARS';
  for (const i of instrumentosIn) {
    if (!extranjera && i.moneda !== 'ARS') throw new DomainError('Las facturas en pesos se cobran en pesos.');
    if (extranjera && i.moneda !== 'ARS' && i.moneda !== moneda) throw new DomainError(`Las facturas son en ${moneda}: el cobro va en ${moneda} o en pesos.`);
  }

  const saldoTotalC = facturas.reduce((s, f) => s + aCent(f.saldo), 0);
  // Valor de cada instrumento en centavos de la moneda de las facturas.
  const enMonedaC = instrumentosIn.filter((i) => i.moneda === moneda).reduce((s, i) => s + aCent(i.monto), 0);
  const pesosDeExtranjeraC = extranjera ? instrumentosIn.filter((i) => i.moneda === 'ARS').reduce((s, i) => s + aCent(i.monto), 0) : 0;
  let cotizacion: number | null = null;
  const cotizacionImplicita = extranjera && pesosDeExtranjeraC > 0 && !(params.cotizacion && params.cotizacion > 0);
  if (extranjera && pesosDeExtranjeraC > 0) {
    if (params.cotizacion && params.cotizacion > 0) cotizacion = params.cotizacion;
    else {
      const restanteC = saldoTotalC - enMonedaC;
      if (restanteC <= 0) throw new DomainError('El cobro supera el saldo de las facturas.');
      cotizacion = pesosDeExtranjeraC / restanteC;
    }
  } else if (extranjera && params.cotizacion && params.cotizacion > 0) {
    cotizacion = params.cotizacion;
  }

  const valores: number[] = instrumentosIn.map((i) => (i.moneda === moneda ? aCent(i.monto) : Math.round(aCent(i.monto) / cotizacion!)));
  if (cotizacionImplicita) {
    // Con cotización implícita los pesos cubren exacto lo que falta: el último
    // instrumento en pesos absorbe el redondeo.
    const idxPesos = instrumentosIn.map((i, k) => (i.moneda === 'ARS' ? k : -1)).filter((k) => k >= 0);
    const ultimo = idxPesos[idxPesos.length - 1];
    const otros = valores.reduce((s, v, k) => (k === ultimo ? s : s + v), 0);
    valores[ultimo] = saldoTotalC - otros;
  }
  const totalC = valores.reduce((s, v) => s + v, 0);
  if (totalC > saldoTotalC) {
    throw new DomainError(`El cobro supera el saldo de las facturas en ${deCent(totalC - saldoTotalC).toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${moneda}.`);
  }

  let instrumentos: { ins: InstrumentoReparto; valorC: number }[] = instrumentosIn.map((ins, k) => ({ ins, valorC: valores[k] }));
  let faltanteC = saldoTotalC - totalC;
  if (params.cerrarDiferenciaComoRetencion && faltanteC > 0) {
    if (extranjera) throw new DomainError('La diferencia sólo se cierra como retención en facturas en pesos.');
    if (faltanteC > saldoTotalC * UMBRAL_RETENCION) {
      throw new DomainError(`La diferencia supera el ${UMBRAL_RETENCION * 100}% del saldo: no parece una retención. Registrá el cobro como parcial.`);
    }
    const base = instrumentosIn[0];
    instrumentos.push({
      ins: { instrumento: 'RETENCION', monto: deCent(faltanteC), moneda: 'ARS', fecha: base.fecha, fechaAcreditacion: base.fecha },
      valorC: faltanteC,
    });
    faltanteC = 0;
  }
  instrumentos = [...instrumentos.filter((x) => !NO_BANCARIOS.has(x.ins.instrumento)), ...instrumentos.filter((x) => NO_BANCARIOS.has(x.ins.instrumento))];

  const orden = facturas
    .map((f, k) => ({ f, k, restoC: aCent(f.saldo) }))
    .sort((a, b) => (a.f.fecha?.getTime() ?? Infinity) - (b.f.fecha?.getTime() ?? Infinity) || a.k - b.k);

  const salida: InstrumentoRepartido[] = [];
  for (const { ins, valorC } of instrumentos) {
    const aplicaciones: AplicacionReparto[] = [];
    let pendienteC = valorC;
    const pesosC = aCent(ins.monto);
    let pesosAsignadosC = 0;
    for (const item of orden) {
      if (pendienteC <= 0) break;
      if (item.restoC <= 0) continue;
      const tomaC = Math.min(pendienteC, item.restoC);
      item.restoC -= tomaC;
      pendienteC -= tomaC;
      let importeArsC: number;
      if (ins.moneda === 'ARS') {
        importeArsC = pendienteC === 0 ? pesosC - pesosAsignadosC : Math.round((pesosC * tomaC) / valorC);
      } else {
        const tasa = cotizacion ?? item.f.tcFactura ?? 0;
        importeArsC = Math.round(tomaC * tasa);
      }
      pesosAsignadosC += importeArsC;
      const diferenciaC = extranjera && item.f.tcFactura != null ? importeArsC - Math.round(tomaC * item.f.tcFactura) : 0;
      aplicaciones.push({ movimientoId: item.f.id, importe: deCent(tomaC), importeArs: deCent(importeArsC), diferenciaCambioArs: deCent(diferenciaC) });
    }
    salida.push({ ...ins, aplicaciones });
  }
  return { instrumentos: salida, faltante: deCent(faltanteC), cotizacion, moneda };
}
