import { describe, it, expect } from 'vitest';
import { resumirCostosPersonal } from '@/lib/empleados/costos';
import { resumirMovimientos, montoVinculadoCentavos, type MovimientoConRelaciones } from '@/lib/movimientos/query';

const linea = (cc: string, pct: number, cliente: string | null = null) => ({
  centroCostoId: cc, clienteId: cliente, proyectoId: null, porcentaje: pct,
});

describe('resumirCostosPersonal', () => {
  it('distribuye el costo de los recibos por sus líneas, en centavos negativos', () => {
    const r = resumirCostosPersonal(
      [{ costoTotalEmpleador: 1000, lineas: [linea('bpo', 60, 'cliA'), linea('adm', 40)] }],
      [],
    );
    expect(r.total).toBe(-100_000);
    expect(r.porCentroCosto.get('bpo')).toBe(-60_000);
    expect(r.porCentroCosto.get('adm')).toBe(-40_000);
    expect(r.porCliente.get('cliA')).toBe(-60_000);
  });

  it('suma la porción vinculada según la distribución de la ficha del empleado', () => {
    const r = resumirCostosPersonal(
      [],
      [{ monto: 200, lineasEmpleado: [linea('bpo', 100)] }],
    );
    expect(r.total).toBe(-20_000);
    expect(r.porCentroCosto.get('bpo')).toBe(-20_000);
  });

  it('un recibo sin líneas suma al total sin desglose (defensivo)', () => {
    const r = resumirCostosPersonal([{ costoTotalEmpleador: 100, lineas: [] }], []);
    expect(r.total).toBe(-10_000);
    expect(r.porCentroCosto.size).toBe(0);
  });

  it('un vínculo de empleado sin distribución suma al total sin desglose', () => {
    const r = resumirCostosPersonal([], [{ monto: 50, lineasEmpleado: [] }]);
    expect(r.total).toBe(-5_000);
  });
});

describe('sin doble conteo: resumirMovimientos descuenta lo vinculado', () => {
  const movVinculado: MovimientoConRelaciones = {
    id: 'm1',
    estado: 'ASIGNADO',
    total: 1000, // factura de prepaga
    tipoComprobante: 'FACTURA_A',
    categoria: { tipo: 'EGRESO', nombre: 'Salud' },
    lineas: [{ centroCostoId: 'adm', clienteId: null, porcentaje: 100 }],
    vinculosEmpleados: [{ monto: 300 }],
  };

  it('montoVinculadoCentavos suma los vínculos', () => {
    expect(montoVinculadoCentavos(movVinculado)).toBe(30_000);
  });

  it('el movimiento aporta total − vinculado según sus propias líneas', () => {
    const r = resumirMovimientos([movVinculado]);
    expect(r.egresos).toBe(-70_000); // 1000 − 300 vinculados = 700 de gasto general
    expect(r.porCentroCosto.get('adm')).toBe(-70_000);
  });

  it('sin vínculos todo sigue igual que antes', () => {
    const r = resumirMovimientos([{ ...movVinculado, vinculosEmpleados: [] }]);
    expect(r.egresos).toBe(-100_000);
  });

  it('vínculos que cubren el total dejan el movimiento en cero para el libro', () => {
    const r = resumirMovimientos([{ ...movVinculado, vinculosEmpleados: [{ monto: 1000 }] }]);
    expect(r.egresos).toBe(0);
  });
});
