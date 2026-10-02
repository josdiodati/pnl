import { MES_LABEL, ejercicioDeMes, periodoDeFecha } from '@/lib/periodos';
import { CRITERIO_LABEL, type CriterioProrrateo } from '@/lib/reportes/prorrateo';
import type { MesPnl } from '@/lib/reportes/pnl';
import type { Desglose, FilaDesglose, SeccionAgrupada, SeccionDesglose } from './desglose-centro';

// Reporte personalizado "Detalle CC" (id desglose-shared-services): piezas
// puras compartidas por la página y su exportable — el rango desde/hasta y las
// filas de la planilla, que replican lo que se ve en pantalla.

export const SECCION_LABEL: Record<SeccionDesglose, string> = {
  INGRESOS: 'Ingresos',
  EGRESOS: 'Egresos operativos',
  PERSONAL: 'Costos de personal',
  SIN_CATEGORIA: 'Sin categoría (revisar)',
};

export const MAX_MESES = 36;

const aMes = (s: string | undefined): MesPnl | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? { anio: Number(m[1]), mes } : null;
};
const indice = (m: MesPnl) => m.anio * 12 + (m.mes - 1);
const deIndice = (i: number): MesPnl => ({ anio: Math.floor(i / 12), mes: (i % 12) + 1 });
export const claveMes = (m: MesPnl) => `${m.anio}-${String(m.mes).padStart(2, '0')}`;
export const mesCorto = (m: MesPnl) => `${MES_LABEL[m.mes].slice(0, 3).toLowerCase()} ${String(m.anio).slice(2)}`;

/**
 * Meses del reporte (YYYY-MM, ambos inclusive). Por defecto: del primer mes
 * del ejercicio corriente al mes actual. Invertidos se ordenan; un valor
 * inválido cae a su defecto; más de MAX_MESES se recorta a los últimos.
 */
export function rangoDetalle(
  params: { desde?: string; hasta?: string },
  hoy: Date,
  inicioEjercicio: number,
): { desde: string; hasta: string; meses: MesPnl[] } {
  const actual = periodoDeFecha(hoy);
  const inicio = { anio: ejercicioDeMes(actual.anio, actual.mes, inicioEjercicio), mes: inicioEjercicio };
  let a = indice(aMes(params.desde) ?? inicio);
  let b = indice(aMes(params.hasta) ?? actual);
  if (a > b) [a, b] = [b, a];
  a = Math.max(a, b - MAX_MESES + 1);
  const meses = Array.from({ length: b - a + 1 }, (_, i) => deIndice(a + i));
  return { desde: claveMes(meses[0]), hasta: claveMes(meses[meses.length - 1]), meses };
}

export type TextosDetalle = {
  describir: (f: FilaDesglose) => { documento: string; concepto: string; detalle?: string };
  nombreCategoria: (id: string) => string;
  nombreCentro: (id: string) => string;
  criterioDe: (centroId: string) => CriterioProrrateo | null;
  /** Criterio del centro del reporte si es prorrateable. */
  criterioCentro: CriterioProrrateo | null;
};

export type FilaExport = {
  nivel: 'seccion' | 'categoria' | 'item' | 'resultado' | 'prorrateo';
  mes: string;
  documento: string;
  concepto: string;
  detalle: string;
  /** Pesos (no centavos), firmados. */
  neto: number | null;
  porcentaje: number | null;
  importe: number | null;
};

const pesos = (c: number) => c / 100;
const fmtDriver = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fmtPesos = (c: number) => `$ ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Texto del driver de un prorrateo recibido (pantalla y planilla). */
export function textoDriver(criterio: CriterioProrrateo | null, driver: number, total: number): string {
  return criterio === 'HEADCOUNT' ? `${fmtDriver(driver)} de ${fmtDriver(total)} cabezas` : `${fmtPesos(driver)} de ${fmtPesos(total)} facturados`;
}
export const fraccionPct = (driver: number, total: number) => (total > 0 ? Math.round((driver / total) * 1000000) / 10000 : 0);

/**
 * Filas de la planilla, en el orden de la pantalla: sección (total),
 * categoría (subtotal), ítems, resultado y prorrateos. En los ítems
 * repartidos va sólo el % asignado a este centro, sin el resto.
 */
export function filasExportDetalle(d: Desglose, secciones: SeccionAgrupada[], t: TextosDetalle): FilaExport[] {
  const vacia = { mes: '', documento: '', concepto: '', detalle: '', neto: null, porcentaje: null };
  const filas: FilaExport[] = [];
  for (const s of secciones) {
    filas.push({ ...vacia, nivel: 'seccion', documento: SECCION_LABEL[s.seccion], importe: pesos(s.total) });
    for (const g of s.grupos) {
      filas.push({
        ...vacia,
        nivel: 'categoria',
        documento: g.categoriaId ? t.nombreCategoria(g.categoriaId) : 'Sueldos y cargas (recibos)',
        concepto: `${g.filas.length} ${g.filas.length === 1 ? 'ítem' : 'ítems'}`,
        importe: pesos(g.subtotal),
      });
      for (const f of g.filas) {
        const x = t.describir(f);
        filas.push({
          nivel: 'item',
          mes: mesCorto(f.mes),
          documento: x.documento,
          concepto: x.concepto,
          detalle: x.detalle ?? '',
          neto: pesos(f.neto),
          porcentaje: f.porcentaje,
          importe: pesos(f.importe),
        });
      }
    }
  }
  const suma = (v: number[]) => v.reduce((a, x) => a + x, 0);
  const conProrrateos = d.recibidos.length > 0 || d.repartido.length > 0;
  filas.push({
    ...vacia,
    nivel: 'resultado',
    documento: conProrrateos ? 'Resultado antes de prorrateos' : 'Resultado del período',
    importe: pesos(suma(d.resultadoAntes)),
  });
  if (!conProrrateos) return filas;

  filas.push({ ...vacia, nivel: 'seccion', documento: t.criterioCentro ? 'Prorrateo de este centro' : 'Prorrateos recibidos', importe: null });
  for (const r of d.recibidos) {
    const criterio = t.criterioDe(r.emisorId);
    filas.push({
      nivel: 'prorrateo',
      mes: mesCorto(r.mes),
      documento: t.nombreCentro(r.emisorId),
      concepto: `Prorrateo por ${criterio ? CRITERIO_LABEL[criterio] : '?'}`,
      detalle: textoDriver(criterio, r.driver, r.totalDriver),
      neto: pesos(r.resultadoEmisor),
      porcentaje: fraccionPct(r.driver, r.totalDriver),
      importe: pesos(r.importe),
    });
  }
  for (const r of d.repartido) {
    filas.push({
      ...vacia,
      nivel: 'prorrateo',
      mes: mesCorto(r.mes),
      documento: 'Repartido a otros centros',
      concepto: t.criterioCentro ? `por ${CRITERIO_LABEL[t.criterioCentro]}` : '',
      detalle: r.sinBase ? 'Sin base de prorrateo: el resultado queda en este centro' : '',
      importe: pesos(r.importe),
    });
  }
  filas.push({ ...vacia, nivel: 'resultado', documento: 'Resultado después de prorrateos', importe: pesos(suma(d.resultadoDespues)) });
  return filas;
}
