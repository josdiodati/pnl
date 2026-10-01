import { describe, it, expect } from 'vitest';
import { armarPnl, type MovimientoPnl } from '@/lib/reportes/pnl';
import { calcularProrrateos } from '@/lib/reportes/prorrateo';
import {
  desglosarCentro,
  agruparDesglose,
  type MovimientoDesglose,
  type ReciboDesglose,
} from '@/lib/reportes-personalizados/desglose-centro';

// Desglose de un centro de costo: el listado itemizado que explica, al
// centavo, la vista del P&L por ese centro (incluidos los prorrateos).

const ago = { anio: 2026, mes: 8 };
const sep = { anio: 2026, mes: 9 };
const meses = [ago, sep];

let n = 0;
const mov = (extra: Partial<MovimientoPnl>, lineas: MovimientoPnl['lineas'], m = sep): MovimientoDesglose => ({
  id: `m${++n}`,
  ...m,
  categoriaId: 'hosting',
  tipoCategoria: 'EGRESO',
  esCostoPersonal: false,
  tipoComprobante: 'FACTURA_A',
  moneda: 'ARS',
  tipoCambio: null,
  total: 1210,
  iva21: 210,
  iva105: null,
  iva27: null,
  percepcionesIva: null,
  percepcionesIibb: null,
  otrosTributos: null,
  lineas,
  ...extra,
});
const al100 = (centroCostoId: string) => [{ centroCostoId, porcentaje: 100 }];

function fixture() {
  const movimientos: MovimientoDesglose[] = [
    mov({}, al100('shared')),
    // Repartido en tres centros: 33,3333 / 33,3333 / 33,3334.
    mov({ total: 1000, iva21: null }, [
      { centroCostoId: 'shared', porcentaje: 33.3333 },
      { centroCostoId: 'bpo', porcentaje: 33.3333 },
      { centroCostoId: 'sf', porcentaje: 33.3334 },
    ]),
    mov({ categoriaId: 'ventas', tipoCategoria: 'INGRESO', total: 5000, iva21: null }, [
      { centroCostoId: 'shared', porcentaje: 20 },
      { centroCostoId: 'bpo', porcentaje: 80 },
    ]),
    mov({ categoriaId: 'prepaga', esCostoPersonal: true, total: 300, iva21: null }, al100('shared'), ago),
    mov({ categoriaId: null, total: 70, iva21: null }, al100('shared')),
    // No es del centro: no aparece.
    mov({}, al100('bpo')),
    // Impuesto indirecto: memo, nunca en el desglose.
    mov({ categoriaId: 'sircreb', esImpuestoIndirecto: true, total: 50, iva21: null }, al100('shared')),
    // USD × TC.
    mov({ moneda: 'USD', tipoCambio: 1000, total: 10, iva21: null }, al100('shared')),
    // USD sin TC: el P&L no lo computa, el desglose tampoco.
    mov({ moneda: 'USD', tipoCambio: null, total: 10, iva21: null }, al100('shared')),
    // Seat Cost (centro prorrateable).
    mov({ categoriaId: 'alquiler', total: 1200, iva21: null }, al100('seat')),
  ];
  const recibos: ReciboDesglose[] = [
    { id: 'r1', ...sep, costoTotalEmpleador: 2000, lineas: [{ centroCostoId: 'sf', porcentaje: 40 }, { centroCostoId: 'shared', porcentaje: 60 }] },
    { id: 'r2', ...sep, costoTotalEmpleador: 1500, lineas: al100('bpo') },
    { id: 'r3', ...sep, costoTotalEmpleador: 999, lineas: [] }, // sin distribución: no es del centro
  ];
  return { movimientos, recibos };
}

describe('desglosarCentro', () => {
  it('cada fila lleva el neto total, el % del centro y el importe que le toca', () => {
    const { movimientos, recibos } = fixture();
    const d = desglosarCentro({ meses, centroId: 'shared', movimientos, recibos });

    const f1 = d.filas.find((f) => f.id === 'm1')!;
    expect(f1).toMatchObject({ seccion: 'EGRESOS', neto: -100000, porcentaje: 100, importe: -100000, otrosCentros: [] });

    const f2 = d.filas.find((f) => f.id === 'm2')!;
    expect(f2.porcentaje).toBe(33.3333);
    expect(f2.importe).toBe(-33333);
    expect(f2.otrosCentros).toEqual([
      { centroCostoId: 'bpo', porcentaje: 33.3333 },
      { centroCostoId: 'sf', porcentaje: 33.3334 },
    ]);

    expect(d.filas.find((f) => f.id === 'm3')).toMatchObject({ seccion: 'INGRESOS', importe: 100000, porcentaje: 20 });
    expect(d.filas.find((f) => f.id === 'm4')).toMatchObject({ seccion: 'PERSONAL', categoriaId: 'prepaga', mes: ago });
    expect(d.filas.find((f) => f.id === 'm5')).toMatchObject({ seccion: 'SIN_CATEGORIA' });
    expect(d.filas.find((f) => f.id === 'm8')).toMatchObject({ importe: -1000000 });

    const r1 = d.filas.find((f) => f.id === 'r1')!;
    expect(r1).toMatchObject({ tipo: 'RECIBO', seccion: 'PERSONAL', categoriaId: null, neto: -200000, porcentaje: 60, importe: -120000 });

    for (const ausente of ['m6', 'm7', 'm9', 'm10', 'r2', 'r3']) expect(d.filas.some((f) => f.id === ausente)).toBe(false);
  });

  it('reproduce al centavo el P&L filtrado por el centro, por sección y mes', () => {
    const { movimientos, recibos } = fixture();
    for (const centroId of ['shared', 'bpo', 'sf', 'seat']) {
      const d = desglosarCentro({ meses, centroId, movimientos, recibos });
      const pnl = armarPnl({ meses, movimientos, recibos, filtro: { campo: 'centroCostoId', valor: centroId } });
      meses.forEach((m, c) => {
        const suma = (s: string) => d.filas.filter((f) => f.seccion === s && f.mes === m).reduce((a, f) => a + f.importe, 0);
        expect(suma('INGRESOS')).toBe(pnl.subtotalIngresos[c]);
        expect(suma('EGRESOS')).toBe(pnl.subtotalEgresos[c]);
        expect(suma('PERSONAL')).toBe(pnl.subtotalPersonal[c]);
        expect(suma('SIN_CATEGORIA')).toBe(pnl.sinCategoria[c]);
        expect(d.resultadoAntes[c]).toBe(pnl.resultado[c]);
      });
    }
  });

  it('los prorrateos recibidos van en una línea por emisor y mes, con su driver', () => {
    const { movimientos, recibos } = fixture();
    const centros = [
      { id: 'shared', prorrateo: null },
      { id: 'bpo', prorrateo: null },
      { id: 'sf', prorrateo: null },
      { id: 'seat', prorrateo: 'HEADCOUNT' as const },
    ];
    const resultadoEmisor = new Map([
      ['seat', armarPnl({ meses, movimientos, recibos, filtro: { campo: 'centroCostoId', valor: 'seat' } }).resultado],
    ]);
    const prorrateos = calcularProrrateos({
      meses,
      centros,
      resultadoEmisor,
      drivers: { HEADCOUNT: new Map([['shared', [0, 0.6]], ['bpo', [0, 7]], ['sf', [0, 2.4]]]), FACTURACION: new Map() },
    });

    const d = desglosarCentro({ meses, centroId: 'shared', movimientos, recibos, prorrateos, resultadoEmisor });
    expect(d.recibidos).toEqual([
      { emisorId: 'seat', mes: sep, resultadoEmisor: -120000, driver: 0.6, totalDriver: 10, importe: -7200 },
    ]);
    expect(d.repartido).toEqual([]);
    expect(d.resultadoDespues[1]).toBe(d.resultadoAntes[1] - 7200);
    expect(d.resultadoDespues[0]).toBe(d.resultadoAntes[0]);

    // El emisor muestra lo que repartió.
    const ds = desglosarCentro({ meses, centroId: 'seat', movimientos, recibos, prorrateos, resultadoEmisor });
    expect(ds.recibidos).toEqual([]);
    expect(ds.repartido).toEqual([{ mes: sep, importe: 120000, sinBase: false }]);
    expect(ds.resultadoDespues[1]).toBe(0);
  });

  it('un emisor sin base de prorrateo lo marca y conserva su resultado', () => {
    const { movimientos, recibos } = fixture();
    const resultadoEmisor = new Map([['seat', [0, -120000]]]);
    const prorrateos = calcularProrrateos({
      meses,
      centros: [{ id: 'seat', prorrateo: 'HEADCOUNT' }, { id: 'bpo', prorrateo: null }],
      resultadoEmisor,
      drivers: { HEADCOUNT: new Map(), FACTURACION: new Map() },
    });
    const ds = desglosarCentro({ meses, centroId: 'seat', movimientos, recibos, prorrateos, resultadoEmisor });
    expect(ds.repartido).toEqual([{ mes: sep, importe: 0, sinBase: true }]);
    expect(ds.resultadoDespues[1]).toBe(-120000);
  });
});

describe('agruparDesglose', () => {
  it('agrupa por sección y categoría con subtotales; sueldos primero en personal', () => {
    const { movimientos, recibos } = fixture();
    const d = desglosarCentro({ meses, centroId: 'shared', movimientos, recibos });
    const g = agruparDesglose(d.filas);
    expect(g.map((s) => s.seccion)).toEqual(['INGRESOS', 'EGRESOS', 'PERSONAL', 'SIN_CATEGORIA']);
    const egresos = g.find((s) => s.seccion === 'EGRESOS')!;
    expect(egresos.grupos.map((x) => x.categoriaId)).toEqual(['hosting']);
    expect(egresos.grupos[0].filas).toHaveLength(3);
    expect(egresos.total).toBe(-100000 - 33333 - 1000000);
    const personal = g.find((s) => s.seccion === 'PERSONAL')!;
    expect(personal.grupos.map((x) => x.categoriaId)).toEqual([null, 'prepaga']);
    expect(personal.grupos[0].subtotal).toBe(-120000);
  });
});
