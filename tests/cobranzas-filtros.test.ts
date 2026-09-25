import { describe, it, expect } from 'vitest';
import { coincideFiltroCobranza, describirFiltroCobranza } from '@/lib/cobranzas/filtros';
import type { InfoCobro } from '@/lib/cobranzas/query';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const hoy = d('2026-09-24'); // jueves; la semana arranca el lunes 21
const info = (over: Partial<InfoCobro>): InfoCobro => ({
  estado: 'PENDIENTE', vencida: false, diasVencida: 0, fechaProbable: { fecha: d('2026-09-25'), fuente: 'VENCIMIENTO' },
  saldo: 100, saldoArs: 100, cobrado: 0, historicoDias: null, chequesEnCartera: [], ...over,
});

describe('coincideFiltroCobranza', () => {
  it('por estado de cobro', () => {
    expect(coincideFiltroCobranza(info({}), { cobro: 'pendientes' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({ vencida: true, diasVencida: 10 }), { cobro: 'vencidas' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({}), { cobro: 'vencidas' }, hoy)).toBe(false);
    expect(coincideFiltroCobranza(info({ estado: 'COBRADA', saldo: 0, saldoArs: 0 }), { cobro: 'cobradas' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({}), { cobro: 'inventado' }, hoy)).toBe(false);
  });
  it('tramo de antigüedad', () => {
    const vencida45 = info({ vencida: true, diasVencida: 45 });
    expect(coincideFiltroCobranza(vencida45, { tramo: '2' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(vencida45, { tramo: '1' }, hoy)).toBe(false);
    expect(coincideFiltroCobranza(info({}), { tramo: '0' }, hoy)).toBe(true);
  });
  it('semana de la proyección: factura estimada o cheque (el de fecha pasada cae en la semana en curso)', () => {
    expect(coincideFiltroCobranza(info({}), { semana: '2026-09-21' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({}), { semana: '2026-09-28' }, hoy)).toBe(false);
    const conCheque = info({ estado: 'COBRADA', saldo: 0, saldoArs: 0, chequesEnCartera: [{ importeArs: 50, fechaAcreditacion: d('2026-09-10') }] });
    expect(coincideFiltroCobranza(conCheque, { semana: '2026-09-21' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(conCheque, { cobro: 'cheques' }, hoy)).toBe(true);
  });
  it('próximos 30 días y después del horizonte', () => {
    expect(coincideFiltroCobranza(info({ fechaProbable: { fecha: d('2026-10-20'), fuente: 'DEFECTO' } }), { cobro: 'prox30' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({ fechaProbable: { fecha: d('2027-03-01'), fuente: 'DEFECTO' } }), { cobro: 'despues' }, hoy)).toBe(true);
    expect(coincideFiltroCobranza(info({ fechaProbable: { fecha: d('2027-03-01'), fuente: 'DEFECTO' } }), { cobro: 'prox30' }, hoy)).toBe(false);
  });
});

describe('describirFiltroCobranza', () => {
  it('arma la frase del filtro activo', () => {
    expect(describirFiltroCobranza({ cobro: 'pendientes', tramo: '2' })).toBe('Facturas por cobrar, vencidas 31–60 días');
    expect(describirFiltroCobranza({})).toBeNull();
  });
});
