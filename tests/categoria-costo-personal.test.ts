import { describe, it, expect } from 'vitest';
import { resumirMovimientos, type MovimientoConRelaciones } from '@/lib/movimientos/query';
import { resumirCostosPersonal } from '@/lib/empleados/costos';

// Categorías marcadas "es costo de personal" (ej. Prepagas): sus movimientos
// salen del resumen general del libro y entran al bloque Costos de personal
// por sus propias líneas — mismo principio sin-doble-conteo de los vínculos.

const prepaga: MovimientoConRelaciones = {
  id: 'm1',
  estado: 'ASIGNADO',
  total: 1000,
  tipoComprobante: 'FACTURA_A',
  categoria: { tipo: 'EGRESO', nombre: 'Prepagas', esCostoPersonal: true },
  lineas: [{ centroCostoId: 'adm', clienteId: null, porcentaje: 100 }],
};

const gastoComun: MovimientoConRelaciones = {
  id: 'm2',
  estado: 'ASIGNADO',
  total: 500,
  tipoComprobante: 'FACTURA_A',
  categoria: { tipo: 'EGRESO', nombre: 'Servicios', esCostoPersonal: false },
  lineas: [{ centroCostoId: 'adm', clienteId: null, porcentaje: 100 }],
};

describe('resumirMovimientos con categoría de costo de personal', () => {
  it('excluye del resumen general los movimientos de categorías de personal', () => {
    const r = resumirMovimientos([prepaga, gastoComun]);
    expect(r.egresos).toBe(-50_000); // sólo el gasto común
    expect(r.porCentroCosto.get('adm')).toBe(-50_000);
  });

  it('sin el flag todo sigue igual', () => {
    const r = resumirMovimientos([{ ...prepaga, categoria: { tipo: 'EGRESO', nombre: 'Prepagas' } }, gastoComun]);
    expect(r.egresos).toBe(-150_000);
  });
});

describe('resumirCostosPersonal con movimientos de categoría personal', () => {
  it('suma los movimientos de personal por sus líneas', () => {
    const r = resumirCostosPersonal(
      [{ costoTotalEmpleador: 2000, lineas: [{ centroCostoId: 'bpo', clienteId: null, proyectoId: null, porcentaje: 100 }] }],
      [],
      [{ firmadoCentavos: -100_000, lineas: [{ centroCostoId: 'adm', clienteId: null, proyectoId: null, porcentaje: 100 }] }],
    );
    expect(r.total).toBe(-300_000); // recibo 2000 + prepaga 1000
    expect(r.porCentroCosto.get('bpo')).toBe(-200_000);
    expect(r.porCentroCosto.get('adm')).toBe(-100_000);
  });

  it('sigue funcionando sin el tercer argumento', () => {
    const r = resumirCostosPersonal([], [{ monto: 50, lineasEmpleado: [] }]);
    expect(r.total).toBe(-5_000);
  });
});
