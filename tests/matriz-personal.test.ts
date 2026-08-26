import { describe, it, expect } from 'vitest';
import { armarMatrizPersonal } from '@/lib/empleados/matriz';

// Matriz de personal por ejercicio: columnas = meses, filas = métricas por
// centro de costo (+ Sin asignar + Total). Identidad contable:
// costo total = netos + retenciones + cargas + prepagas + vinculados.

const meses = [
  { anio: 2026, mes: 7 },
  { anio: 2026, mes: 8 },
];

const reciboGodoy = {
  anio: 2026,
  mes: 7,
  tipo: 'MENSUAL',
  estado: 'CONFIRMADO' as const,
  empleadoId: 'godoy',
  sueldoNeto: 640000,
  retenciones: 160000,
  contribucionesEmpleador: 254673.29,
  costoTotalEmpleador: 1054673.29,
  lineas: [
    { centroCostoId: 'bpo', porcentaje: 60 },
    { centroCostoId: 'sf', porcentaje: 40 },
  ],
};

const reciboPendiente = {
  anio: 2026,
  mes: 7,
  tipo: 'MENSUAL',
  estado: 'PENDIENTE_REVISION' as const,
  empleadoId: 'aranda',
  sueldoNeto: 624000,
  retenciones: 156000,
  contribucionesEmpleador: 248347.29,
  costoTotalEmpleador: 1028347.29,
  lineas: [],
};

const reciboSac = {
  anio: 2026,
  mes: 8,
  tipo: 'SAC',
  estado: 'CONFIRMADO' as const,
  empleadoId: 'godoy',
  sueldoNeto: 320000,
  retenciones: 80000,
  contribucionesEmpleador: 127336.64,
  costoTotalEmpleador: 527336.64,
  lineas: [{ centroCostoId: 'bpo', porcentaje: 100 }],
};

describe('armarMatrizPersonal', () => {
  const m = armarMatrizPersonal({
    meses,
    recibos: [reciboGodoy, reciboPendiente, reciboSac],
    prepagas: [{ anio: 2026, mes: 7, centavos: 200_000_00, lineas: [{ centroCostoId: 'adm', porcentaje: 100 }] }],
    vinculados: [{ anio: 2026, mes: 8, centavos: 10_000_00, lineas: [{ centroCostoId: 'bpo', porcentaje: 100 }] }],
  });

  it('headcount ponderado por distribución, pendiente a Sin asignar, total entero', () => {
    const hc = m.headcount;
    expect(hc.porCentro.get('bpo')![0]).toBeCloseTo(0.6);
    expect(hc.porCentro.get('sf')![0]).toBeCloseTo(0.4);
    expect(hc.sinAsignar[0]).toBe(1);
    expect(hc.total[0]).toBe(2); // empleados distintos con recibo del mes
    // el SAC de agosto no suma headcount (no es recibo MENSUAL)
    expect(hc.total[1]).toBe(0);
  });

  it('netos por centro en centavos exactos (la última línea absorbe el redondeo)', () => {
    expect(m.netos.porCentro.get('bpo')![0]).toBe(38_400_000);
    expect(m.netos.porCentro.get('sf')![0]).toBe(25_600_000);
    expect(m.netos.sinAsignar[0]).toBe(62_400_000);
    expect(m.netos.total[0]).toBe(126_400_000);
  });

  it('el SAC computa en las filas de componentes y además en su fila memo', () => {
    expect(m.sacOtros.total[1]).toBe(52_733_664);
    expect(m.netos.total[1]).toBe(32_000_000);
  });

  it('identidad: costo total = netos + retenciones + cargas + prepagas + vinculados', () => {
    for (let i = 0; i < meses.length; i++) {
      expect(m.costoTotal.total[i]).toBe(
        m.netos.total[i] + m.retenciones.total[i] + m.cargas.total[i] + m.prepagas.total[i] + m.vinculados.total[i],
      );
    }
  });

  it('prepagas y vinculados caen en su centro y mes', () => {
    expect(m.prepagas.porCentro.get('adm')![0]).toBe(200_000_00);
    expect(m.vinculados.porCentro.get('bpo')![1]).toBe(10_000_00);
  });
});
