import { describe, it, expect } from 'vitest';
import { proyectarCobranzas, inicioSemana } from '@/lib/cobranzas/proyeccion';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const hoy = d('2026-09-24'); // jueves

describe('proyectarCobranzas', () => {
  it('la semana arranca el lunes', () => {
    expect(inicioSemana(hoy)).toEqual(d('2026-09-21'));
    expect(inicioSemana(d('2026-09-27'))).toEqual(d('2026-09-21')); // domingo
  });

  it('separa confirmado (cheques) de estimado (facturas) por semana, con vencido y después', () => {
    const p = proyectarCobranzas({
      hoy,
      ventas: [
        { id: 'a', cliente: 'Comnet', saldoArs: 1000, fechaProbable: d('2026-09-25'), diasVencida: 0 },
        { id: 'b', cliente: 'Comnet', saldoArs: 500, fechaProbable: d('2026-08-20'), diasVencida: 35 },
        { id: 'c', cliente: 'Mutual', saldoArs: 200, fechaProbable: d('2026-10-06'), diasVencida: 0 },
        { id: 'd', cliente: 'Mutual', saldoArs: 50, fechaProbable: d('2027-03-01'), diasVencida: 0 },
        { id: 'e', cliente: 'Cubecorp', saldoArs: null, fechaProbable: d('2026-10-01'), diasVencida: 0 },
      ],
      cheques: [
        { id: 'ch1', cliente: 'Mutual', montoArs: 300, fechaAcreditacion: d('2026-09-10') }, // fecha pasada: semana en curso
        { id: 'ch2', cliente: 'Mutual', montoArs: 400, fechaAcreditacion: d('2026-10-01') },
      ],
    });
    expect(p.semanas).toHaveLength(12);
    expect(p.semanas[0]).toMatchObject({ desde: d('2026-09-21'), hasta: d('2026-09-27'), confirmado: 300, estimado: 1000 });
    expect(p.semanas[1]).toMatchObject({ confirmado: 400, estimado: 0 });
    expect(p.semanas[2]).toMatchObject({ confirmado: 0, estimado: 200 });
    expect(p.vencido).toBe(500);
    expect(p.despues).toEqual({ confirmado: 0, estimado: 50 });
    expect(p.kpis).toEqual({ aCobrar: 1750, vencido: 500, chequesEnCartera: 700, proximos30: 1900 });
    expect(p.sinTipoCambio).toBe(1);
    expect(p.antiguedad[0]).toEqual({ cliente: 'Comnet', tramos: [1000, 0, 500, 0, 0], total: 1500 });
  });
});
