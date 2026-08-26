import { importesPorLinea } from '@/lib/movimientos/distribucion';

// Matriz de personal por ejercicio (vista /empleados): columnas = meses del
// ciclo contable, filas = métricas por centro de costo + "Sin asignar" +
// Total. Todo derivado query-time de recibos, prepagas (categorías de costo
// de personal) y vínculos. Dinero en CENTAVOS positivos (son costos);
// headcount ponderado por la distribución de cada recibo mensual.
//
// Identidad contable (por recibo: costoTotal = neto + retenciones + cargas):
//   costoTotal = netos + retenciones + cargas + prepagas + vinculados
// La fila SAC/otros es un memo (ya incluida en las filas de componentes).

export type MesMatriz = { anio: number; mes: number };
export type LineaPct = { centroCostoId: string; porcentaje: number };

export type ReciboMatriz = {
  anio: number;
  mes: number;
  tipo: string;
  estado: 'CONFIRMADO' | 'PENDIENTE_REVISION';
  empleadoId: string;
  sueldoNeto: number | null;
  retenciones: number | null;
  contribucionesEmpleador: number | null;
  costoTotalEmpleador: number | null;
  lineas: LineaPct[];
};

/** Aporte ya expresado en centavos (prepagas o vinculados) con su reparto. */
export type AporteMatriz = { anio: number; mes: number; centavos: number; lineas: LineaPct[] };

export type SerieMatriz = {
  porCentro: Map<string, number[]>;
  sinAsignar: number[];
  total: number[];
};

export type MatrizPersonal = {
  meses: MesMatriz[];
  headcount: SerieMatriz;
  netos: SerieMatriz;
  retenciones: SerieMatriz;
  cargas: SerieMatriz;
  sacOtros: SerieMatriz;
  prepagas: SerieMatriz;
  vinculados: SerieMatriz;
  costoTotal: SerieMatriz;
};

function serieVacia(n: number): SerieMatriz {
  return { porCentro: new Map(), sinAsignar: Array(n).fill(0), total: Array(n).fill(0) };
}

function sumar(serie: SerieMatriz, centroCostoId: string | null, col: number, valor: number): void {
  if (valor === 0) return;
  if (centroCostoId == null) {
    serie.sinAsignar[col] += valor;
  } else {
    if (!serie.porCentro.has(centroCostoId)) {
      serie.porCentro.set(centroCostoId, Array(serie.total.length).fill(0));
    }
    serie.porCentro.get(centroCostoId)![col] += valor;
  }
  serie.total[col] += valor;
}

/** Reparte centavos por líneas (centavo-exacto); sin líneas va a Sin asignar. */
function repartir(serie: SerieMatriz, col: number, centavos: number, lineas: LineaPct[]): void {
  if (centavos === 0) return;
  if (!lineas.length) {
    sumar(serie, null, col, centavos);
    return;
  }
  try {
    const importes = importesPorLinea(centavos, lineas);
    lineas.forEach((l, i) => sumar(serie, l.centroCostoId, col, importes[i]));
  } catch {
    sumar(serie, null, col, centavos); // líneas inconsistentes: al menos no se pierde
  }
}

const cents = (v: number | null): number => (v == null ? 0 : Math.round(v * 100));

export function armarMatrizPersonal(input: {
  meses: MesMatriz[];
  recibos: ReciboMatriz[];
  prepagas: AporteMatriz[];
  vinculados: AporteMatriz[];
}): MatrizPersonal {
  const n = input.meses.length;
  const columna = new Map(input.meses.map((m, i) => [`${m.anio}-${m.mes}`, i]));
  const col = (anio: number, mes: number) => columna.get(`${anio}-${mes}`);

  const m: MatrizPersonal = {
    meses: input.meses,
    headcount: serieVacia(n),
    netos: serieVacia(n),
    retenciones: serieVacia(n),
    cargas: serieVacia(n),
    sacOtros: serieVacia(n),
    prepagas: serieVacia(n),
    vinculados: serieVacia(n),
    costoTotal: serieVacia(n),
  };

  const empleadosDelMes = new Map<number, Set<string>>();

  for (const r of input.recibos) {
    const c = col(r.anio, r.mes);
    if (c == null) continue;
    const sinAsignar = r.estado === 'PENDIENTE_REVISION' || !r.lineas.length;
    const lineas = sinAsignar ? [] : r.lineas;

    // Headcount: sólo el recibo mensual cuenta cabezas, ponderado por líneas.
    // El total NO es la suma de ponderados sino empleados distintos (entero),
    // así que acá se cargan sólo las filas y el total se fija al final.
    if (r.tipo === 'MENSUAL') {
      if (!empleadosDelMes.has(c)) empleadosDelMes.set(c, new Set());
      empleadosDelMes.get(c)!.add(r.empleadoId);
      if (lineas.length) {
        for (const l of lineas) {
          if (!m.headcount.porCentro.has(l.centroCostoId)) {
            m.headcount.porCentro.set(l.centroCostoId, Array(n).fill(0));
          }
          m.headcount.porCentro.get(l.centroCostoId)![c] += l.porcentaje / 100;
        }
      } else {
        m.headcount.sinAsignar[c] += 1;
      }
    }

    repartir(m.netos, c, cents(r.sueldoNeto), lineas);
    repartir(m.retenciones, c, cents(r.retenciones), lineas);
    repartir(m.cargas, c, cents(r.contribucionesEmpleador), lineas);
    if (r.tipo !== 'MENSUAL') repartir(m.sacOtros, c, cents(r.costoTotalEmpleador), lineas);
    repartir(m.costoTotal, c, cents(r.costoTotalEmpleador), lineas);
  }

  // Total de headcount: empleados distintos con recibo mensual del mes (entero).
  for (const [c, set] of empleadosDelMes) m.headcount.total[c] = set.size;

  for (const p of input.prepagas) {
    const c = col(p.anio, p.mes);
    if (c == null) continue;
    repartir(m.prepagas, c, p.centavos, p.lineas);
    repartir(m.costoTotal, c, p.centavos, p.lineas);
  }
  for (const v of input.vinculados) {
    const c = col(v.anio, v.mes);
    if (c == null) continue;
    repartir(m.vinculados, c, v.centavos, v.lineas);
    repartir(m.costoTotal, c, v.centavos, v.lineas);
  }

  return m;
}
