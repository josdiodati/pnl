import { describe, it, expect } from 'vitest';
import {
  headcountPorCentro,
  facturacionPorCentro,
  repartirProporcional,
  calcularProrrateos,
  type EmpleadoHeadcount,
  type ReciboHeadcount,
} from '@/lib/reportes/prorrateo';
import { armarPnl, type MovimientoPnl, type ReciboPnl } from '@/lib/reportes/pnl';

// Prorrateo de centros de costo (método directo): un centro prorrateable
// reparte su resultado del mes a los centros NO prorrateables según un driver
// (headcount o facturación); los prorrateables nunca reciben y su driver no
// cuenta en el denominador.

const sep = { anio: 2026, mes: 9 };
const meses = [sep];

const empleado = (id: string, ficha: EmpleadoHeadcount['ficha'], extra: Partial<EmpleadoHeadcount> = {}): EmpleadoHeadcount => ({
  id,
  activo: true,
  fechaIngreso: null,
  fechaEgreso: null,
  ficha,
  ...extra,
});
const recibo = (empleadoId: string, lineas: ReciboHeadcount['lineas'], m = sep): ReciboHeadcount => ({ empleadoId, ...m, lineas });
const al100 = (centroCostoId: string) => [{ centroCostoId, porcentaje: 100 }];

// Ewwo sep-2026: Administración 2, BPO 7, SF 2,4, Seat Cost 1, Shared 0,6 = 13.
function plantillaEwwo() {
  const recibos: ReciboHeadcount[] = [];
  const empleados: EmpleadoHeadcount[] = [];
  let i = 0;
  const alta = (lineas: ReciboHeadcount['lineas']) => {
    const id = `e${++i}`;
    empleados.push(empleado(id, lineas));
    recibos.push(recibo(id, lineas));
  };
  alta(al100('adm'));
  alta(al100('adm'));
  for (let k = 0; k < 7; k++) alta(al100('bpo'));
  alta(al100('sf'));
  alta(al100('sf'));
  alta([{ centroCostoId: 'sf', porcentaje: 40 }, { centroCostoId: 'shared', porcentaje: 60 }]);
  alta(al100('seat'));
  return { recibos, empleados };
}

describe('headcountPorCentro', () => {
  it('pondera por la distribución del recibo mensual confirmado', () => {
    const { recibos, empleados } = plantillaEwwo();
    const hc = headcountPorCentro({ meses, recibos, empleados });
    expect(hc.get('bpo')).toEqual([7]);
    expect(hc.get('adm')).toEqual([2]);
    expect(hc.get('sf')![0]).toBeCloseTo(2.4, 10);
    expect(hc.get('shared')![0]).toBeCloseTo(0.6, 10);
    expect(hc.get('seat')).toEqual([1]);
  });

  it('sin recibo confirmado usa la ficha; el recibo confirmado gana sobre la ficha', () => {
    const empleados = [empleado('a', al100('bpo')), empleado('b', al100('bpo'))];
    // 'b' tiene recibo confirmado con otra distribución: manda el recibo.
    const hc = headcountPorCentro({ meses, recibos: [recibo('b', al100('sf'))], empleados });
    expect(hc.get('bpo')).toEqual([1]);
    expect(hc.get('sf')).toEqual([1]);
  });

  it('la ficha no cuenta para un egresado antes del mes, ni antes del ingreso, ni para un inactivo sin egreso', () => {
    const empleados = [
      empleado('egresado', al100('bpo'), { fechaEgreso: new Date('2026-08-15T00:00:00Z'), activo: false }),
      empleado('egresaEnSep', al100('bpo'), { fechaEgreso: new Date('2026-09-10T00:00:00Z') }),
      empleado('ingresaOct', al100('bpo'), { fechaIngreso: new Date('2026-10-01T00:00:00Z') }),
      empleado('ingresaSep', al100('bpo'), { fechaIngreso: new Date('2026-09-20T00:00:00Z') }),
      empleado('inactivo', al100('bpo'), { activo: false }),
    ];
    const hc = headcountPorCentro({ meses, recibos: [], empleados });
    expect(hc.get('bpo')).toEqual([2]); // egresaEnSep + ingresaSep
  });
});

describe('facturacionPorCentro', () => {
  const venta = (total: number, lineas: { centroCostoId: string; porcentaje: number }[], extra: Partial<MovimientoPnl> = {}): MovimientoPnl => ({
    ...sep,
    categoriaId: 'ventas',
    tipoCategoria: 'INGRESO',
    esCostoPersonal: false,
    tipoComprobante: 'FACTURA_A',
    moneda: 'ARS',
    tipoCambio: null,
    total,
    iva21: null,
    iva105: null,
    iva27: null,
    percepcionesIva: null,
    percepcionesIibb: null,
    otrosTributos: null,
    lineas,
    ...extra,
  });

  it('suma la base neta de ventas por centro según sus líneas, ignora egresos', () => {
    const f = facturacionPorCentro({
      meses,
      movimientos: [
        venta(121, al100('bpo'), { iva21: 21 }),
        venta(200, [{ centroCostoId: 'bpo', porcentaje: 50 }, { centroCostoId: 'sf', porcentaje: 50 }]),
        venta(999, al100('sf'), { tipoCategoria: 'EGRESO' }),
      ],
    });
    expect(f.get('bpo')).toEqual([20_000]);
    expect(f.get('sf')).toEqual([10_000]);
  });
});

describe('repartirProporcional', () => {
  it('reparte al centavo por mayor resto, con el signo del total', () => {
    expect(repartirProporcional(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(repartirProporcional(1000, [7, 5])).toEqual([583, 417]);
    const partes = repartirProporcional(-123_457, [7, 2.4, 0.6, 2]);
    expect(partes.reduce((a, v) => a + v, 0)).toBe(-123_457);
  });
});

describe('calcularProrrateos — método directo', () => {
  const centros = [
    { id: 'adm', prorrateo: null },
    { id: 'bpo', prorrateo: null },
    { id: 'sf', prorrateo: null },
    { id: 'shared', prorrateo: null },
    { id: 'seat', prorrateo: 'HEADCOUNT' as const },
  ];

  it('Ewwo: Seat Cost reparte con base 12 (sin su propia cabeza); BPO recibe 7/12', () => {
    const { recibos, empleados } = plantillaEwwo();
    const hc = headcountPorCentro({ meses, recibos, empleados });
    const r = calcularProrrateos({
      meses,
      centros,
      resultadoEmisor: new Map([['seat', [-1_200_000]]]),
      drivers: { HEADCOUNT: hc, FACTURACION: new Map() },
    });
    expect(r.recibidos.get('bpo')!.get('seat')).toEqual([-700_000]);
    expect(r.recibidos.get('adm')!.get('seat')).toEqual([-200_000]);
    expect(r.recibidos.get('seat')).toBeUndefined();
    expect(r.repartido.get('seat')).toEqual([1_200_000]);
    expect(r.base.get('seat')!.total[0]).toBeCloseTo(12, 10);
    expect(r.base.get('seat')!.porReceptor.get('bpo')).toEqual([7]);
    const recibido = [...r.recibidos.values()].reduce((a, m) => a + (m.get('seat')?.[0] ?? 0), 0);
    expect(recibido).toBe(-1_200_000);
  });

  it('dos emisores: ninguno recibe del otro y la base excluye a ambos (BPO 7/10)', () => {
    const { recibos, empleados } = plantillaEwwo();
    const hc = headcountPorCentro({ meses, recibos, empleados });
    const conAdm = centros.map((c) => (c.id === 'adm' ? { ...c, prorrateo: 'HEADCOUNT' as const } : c));
    const r = calcularProrrateos({
      meses,
      centros: conAdm,
      resultadoEmisor: new Map([['seat', [-1_000_000]], ['adm', [-500_000]]]),
      drivers: { HEADCOUNT: hc, FACTURACION: new Map() },
    });
    expect(r.recibidos.get('bpo')!.get('seat')).toEqual([-700_000]);
    expect(r.recibidos.get('bpo')!.get('adm')).toEqual([-350_000]);
    expect(r.recibidos.get('adm')).toBeUndefined();
    expect(r.recibidos.get('seat')).toBeUndefined();
  });

  it('la porción de un empleado asignada al emisor se descarta del denominador', () => {
    const hc = headcountPorCentro({
      meses,
      recibos: [recibo('a', [{ centroCostoId: 'seat', porcentaje: 40 }, { centroCostoId: 'bpo', porcentaje: 60 }]), recibo('b', al100('sf'))],
      empleados: [],
    });
    const r = calcularProrrateos({
      meses,
      centros,
      resultadoEmisor: new Map([['seat', [-1_600]]]),
      drivers: { HEADCOUNT: hc, FACTURACION: new Map() },
    });
    expect(r.base.get('seat')!.total[0]).toBeCloseTo(1.6, 10);
    expect(r.recibidos.get('bpo')!.get('seat')).toEqual([-600]);
    expect(r.recibidos.get('sf')!.get('seat')).toEqual([-1_000]);
  });

  it('sin base (driver total 0) no reparte y lo marca', () => {
    const r = calcularProrrateos({
      meses,
      centros,
      resultadoEmisor: new Map([['seat', [-5_000]]]),
      drivers: { HEADCOUNT: new Map(), FACTURACION: new Map() },
    });
    expect(r.repartido.get('seat')).toEqual([0]);
    expect(r.sinBase.get('seat')).toEqual([true]);
    expect(r.recibidos.size).toBe(0);
  });

  it('facturación: un centro con facturación negativa cuenta 0', () => {
    const r = calcularProrrateos({
      meses,
      centros: centros.map((c) => (c.id === 'seat' ? { ...c, prorrateo: 'FACTURACION' as const } : c)),
      resultadoEmisor: new Map([['seat', [-9_000]]]),
      drivers: { HEADCOUNT: new Map(), FACTURACION: new Map([['bpo', [300]], ['sf', [-100]], ['shared', [600]], ['seat', [5_000]]]) },
    });
    expect(r.recibidos.get('bpo')!.get('seat')).toEqual([-3_000]);
    expect(r.recibidos.get('shared')!.get('seat')).toEqual([-6_000]);
    expect(r.recibidos.get('sf')).toBeUndefined();
  });

  it('invariante: Σ resultados después de prorrateos por centro + sin distribución = total sin filtro', () => {
    const { recibos: hcRecibos, empleados } = plantillaEwwo();
    const hc = headcountPorCentro({ meses, recibos: hcRecibos, empleados });
    const gasto = (total: number, centroCostoId: string): MovimientoPnl => ({
      ...sep, categoriaId: 'g', tipoCategoria: 'EGRESO', esCostoPersonal: false, tipoComprobante: 'FACTURA_A', moneda: 'ARS',
      tipoCambio: null, total, iva21: null, iva105: null, iva27: null, percepcionesIva: null, percepcionesIibb: null, otrosTributos: null,
      lineas: al100(centroCostoId),
    });
    const movimientos = [gasto(1234.57, 'seat'), gasto(500, 'bpo'), gasto(77.77, 'sf')];
    const recibosPnl: ReciboPnl[] = [{ ...sep, costoTotalEmpleador: 999.99, lineas: al100('seat') }];
    const pnlDe = (centro: string) => armarPnl({ meses, movimientos, recibos: recibosPnl, filtro: { campo: 'centroCostoId', valor: centro } });
    const r = calcularProrrateos({
      meses,
      centros,
      resultadoEmisor: new Map([['seat', pnlDe('seat').resultado]]),
      drivers: { HEADCOUNT: hc, FACTURACION: new Map() },
    });
    const despues = (centro: string) => {
      const recibido = [...(r.recibidos.get(centro)?.values() ?? [])].reduce((a, v) => a + v[0], 0);
      return pnlDe(centro).resultado[0] + recibido + (r.repartido.get(centro)?.[0] ?? 0);
    };
    const suma = centros.reduce((a, c) => a + despues(c.id), 0);
    const sin = armarPnl({ meses, movimientos, recibos: recibosPnl, filtro: { campo: 'centroCostoId', valor: null } }).resultado[0];
    const total = armarPnl({ meses, movimientos, recibos: recibosPnl }).resultado[0];
    expect(suma + sin).toBe(total);
    expect(despues('seat')).toBe(0);
  });
});
