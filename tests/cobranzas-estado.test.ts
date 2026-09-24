import { describe, it, expect } from 'vitest';
import {
  esCobrable,
  saldoVenta,
  estadoCobro,
  fechaProbableCobro,
  atrasoHistoricoDias,
  PLAZO_DEFECTO_DIAS,
  type VentaCobrable,
} from '@/lib/cobranzas/estado';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function venta(over: Partial<VentaCobrable> = {}): VentaCobrable {
  return {
    id: 'v1',
    fecha: d('2026-07-31'),
    total: 1000,
    moneda: 'ARS',
    tipoCambio: null,
    tipoComprobante: 'FACTURA_A',
    estado: 'ASIGNADO',
    fechaVencimientoPago: null,
    fechaCobroEstimada: null,
    plazoCobroDias: null,
    aplicaciones: [],
    ...over,
  };
}
const aplic = (importe: number, fechaAcreditacion: string, estadoCobro = 'ACREDITADO', importeArs = importe) => ({
  importe,
  importeArs,
  estadoCobro,
  fechaAcreditacion: d(fechaAcreditacion),
});

describe('esCobrable', () => {
  it('facturas vigentes con total positivo son cobrables', () => {
    expect(esCobrable(venta())).toBe(true);
    expect(esCobrable(venta({ estado: 'PENDIENTE_VALIDACION' }))).toBe(true);
  });
  it('notas de crédito, anuladas, duplicadas, en error o sin total no', () => {
    expect(esCobrable(venta({ tipoComprobante: 'NOTA_CREDITO_A' }))).toBe(false);
    expect(esCobrable(venta({ estado: 'ANULADO' }))).toBe(false);
    expect(esCobrable(venta({ estado: 'DUPLICADO' }))).toBe(false);
    expect(esCobrable(venta({ estado: 'ERROR_PROCESAMIENTO' }))).toBe(false);
    expect(esCobrable(venta({ total: null }))).toBe(false);
  });
});

describe('saldoVenta', () => {
  it('descuenta las aplicaciones de cobros no rechazados', () => {
    const s = saldoVenta(venta({ aplicaciones: [aplic(300, '2026-08-01'), aplic(200, '2026-08-02', 'RECHAZADO')] }));
    expect(s.cobrado).toBe(300);
    expect(s.saldo).toBe(700);
    expect(s.saldoArs).toBe(700);
  });
  it('en moneda extranjera pesifica el saldo al TC de la factura', () => {
    const s = saldoVenta(venta({ moneda: 'USD', tipoCambio: 1500, total: 100, aplicaciones: [aplic(40, '2026-08-01', 'ACREDITADO', 61000)] }));
    expect(s.saldo).toBe(60);
    expect(s.saldoArs).toBe(90000);
  });
  it('sin TC el saldo en pesos no es computable', () => {
    expect(saldoVenta(venta({ moneda: 'USD', tipoCambio: null })).saldoArs).toBeNull();
  });
  it('redondea a centavos', () => {
    expect(saldoVenta(venta({ total: 0.3, aplicaciones: [aplic(0.1, '2026-08-01'), aplic(0.2, '2026-08-01')] })).saldo).toBe(0);
  });
});

describe('fechaProbableCobro', () => {
  it('la fecha manual gana a todo', () => {
    const r = fechaProbableCobro(venta({ fechaCobroEstimada: d('2026-09-10'), fechaVencimientoPago: d('2026-08-10'), plazoCobroDias: 5 }), 12);
    expect(r).toEqual({ fecha: d('2026-09-10'), fuente: 'MANUAL' });
  });
  it('después el vencimiento impreso en la factura', () => {
    expect(fechaProbableCobro(venta({ fechaVencimientoPago: d('2026-08-10'), plazoCobroDias: 5 }), 12)).toEqual({ fecha: d('2026-08-10'), fuente: 'VENCIMIENTO' });
  });
  it('después el plazo del cliente', () => {
    expect(fechaProbableCobro(venta({ plazoCobroDias: 5 }), 12)).toEqual({ fecha: d('2026-08-05'), fuente: 'PLAZO_CLIENTE' });
  });
  it('después el histórico del cliente', () => {
    expect(fechaProbableCobro(venta(), 12)).toEqual({ fecha: d('2026-08-12'), fuente: 'HISTORICO' });
  });
  it('por defecto 30 días', () => {
    expect(PLAZO_DEFECTO_DIAS).toBe(30);
    expect(fechaProbableCobro(venta(), null)).toEqual({ fecha: d('2026-08-30'), fuente: 'DEFECTO' });
  });
  it('sin fecha de factura y sin override no hay fecha probable', () => {
    expect(fechaProbableCobro(venta({ fecha: null }), 10)).toBeNull();
  });
});

describe('estadoCobro', () => {
  const hoy = d('2026-09-01');
  it('cobrada cuando el saldo es cero', () => {
    const v = venta({ aplicaciones: [aplic(1000, '2026-08-05')] });
    expect(estadoCobro(v, hoy)).toMatchObject({ estado: 'COBRADA', vencida: false });
  });
  it('parcial y vencida con los días de atraso', () => {
    const v = venta({ fechaVencimientoPago: d('2026-08-10'), aplicaciones: [aplic(400, '2026-08-05')] });
    expect(estadoCobro(v, hoy)).toEqual({ estado: 'PARCIAL', vencida: true, diasVencida: 22, fechaProbable: { fecha: d('2026-08-10'), fuente: 'VENCIMIENTO' } });
  });
  it('pendiente no vencida', () => {
    const v = venta({ fechaVencimientoPago: d('2026-09-15') });
    expect(estadoCobro(v, hoy)).toMatchObject({ estado: 'PENDIENTE', vencida: false, diasVencida: 0 });
  });
  it('una nota de crédito no aplica', () => {
    expect(estadoCobro(venta({ tipoComprobante: 'NOTA_CREDITO_A' }), hoy).estado).toBe('NO_APLICA');
  });
});

describe('atrasoHistoricoDias', () => {
  it('promedia los días hasta la última acreditación de las facturas cobradas completas', () => {
    const ventas = [
      venta({ id: 'a', fecha: d('2026-07-01'), aplicaciones: [aplic(1000, '2026-07-11')] }), // 10
      venta({ id: 'b', fecha: d('2026-07-10'), aplicaciones: [aplic(500, '2026-07-15'), aplic(500, '2026-07-30')] }), // 20
      venta({ id: 'c', fecha: d('2026-08-01'), aplicaciones: [aplic(100, '2026-08-02')] }), // parcial: no cuenta
    ];
    expect(atrasoHistoricoDias(ventas)).toBe(15);
  });
  it('usa sólo las últimas 6 facturas cobradas', () => {
    const ventas = Array.from({ length: 8 }, (_, i) =>
      venta({ id: `v${i}`, fecha: d(`2026-0${i < 4 ? 1 : 2}-0${(i % 4) + 1}`), aplicaciones: [aplic(1000, i < 2 ? '2026-03-30' : `2026-0${i < 4 ? 1 : 2}-1${(i % 4) + 1}`)] }),
    );
    // Las dos más viejas (enero 1 y 2, cobradas fines de marzo) quedan fuera; el resto: 10 días.
    expect(atrasoHistoricoDias(ventas)).toBe(10);
  });
  it('sin cobradas no hay histórico; un cobro anticipado cuenta como 0', () => {
    expect(atrasoHistoricoDias([venta()])).toBeNull();
    expect(atrasoHistoricoDias([venta({ aplicaciones: [aplic(1000, '2026-07-01')] })])).toBe(0);
  });
});
