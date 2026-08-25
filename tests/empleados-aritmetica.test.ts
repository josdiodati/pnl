import { describe, it, expect } from 'vitest';
import { verificarAritmeticaRecibo, calcularCostoTotal, type TotalesRecibo } from '@/lib/empleados/aritmetica';

// Página 4 del PDF real (Fazzini): caso estándar que cierra exacto.
const FAZZINI: TotalesRecibo = {
  brutoRemunerativo: 4_770_000,
  noRemunerativo: 0.06,
  retenciones: 913_186.06,
  sueldoNeto: 3_856_814,
  contribucionesEmpleador: 1_223_553.96,
  costoTotalEmpleador: 5_993_554.02,
};

// Página 1 (Frontera): con Recupero de Adelanto de Sueldos entre las retenciones.
// El adelanto baja el NETO pero no cambia el costo empleador.
const FRONTERA: TotalesRecibo = {
  brutoRemunerativo: 4_770_000,
  noRemunerativo: 0.8,
  retenciones: 3_419_512.8,
  sueldoNeto: 1_350_488,
  contribucionesEmpleador: 1_221_290.34,
  costoTotalEmpleador: 5_991_291.14,
};

// Página 11 (Aranda, media jornada): el sueldo devengado es la mitad del de header.
const ARANDA: TotalesRecibo = {
  brutoRemunerativo: 780_000,
  noRemunerativo: 0,
  retenciones: 156_000,
  sueldoNeto: 624_000,
  contribucionesEmpleador: 248_347.29,
  costoTotalEmpleador: 1_028_347.29,
};

describe('verificarAritmeticaRecibo', () => {
  it('cierra los tres casos reales del PDF de Ewwo', () => {
    expect(verificarAritmeticaRecibo(FAZZINI)).toEqual({});
    expect(verificarAritmeticaRecibo(FRONTERA)).toEqual({});
    expect(verificarAritmeticaRecibo(ARANDA)).toEqual({});
  });

  it('tolera hasta $1 de redondeo', () => {
    expect(verificarAritmeticaRecibo({ ...ARANDA, sueldoNeto: 624_000.99 })).toEqual({});
  });

  it('flaggea neto que no cierra', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, sueldoNeto: 600_000 });
    expect(r.sueldoNeto).toMatch(/no cierra/);
  });

  it('flaggea costo total que no cierra', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, costoTotalEmpleador: 999_999 });
    expect(r.costoTotalEmpleador).toMatch(/no cierra/);
  });

  it('flaggea costo total faltante', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, costoTotalEmpleador: null });
    expect(r.costoTotalEmpleador).toMatch(/No se pudo extraer/);
  });

  it('no exige el chequeo de neto si faltan sus insumos', () => {
    const r = verificarAritmeticaRecibo({ ...ARANDA, retenciones: null });
    expect(r.retenciones).toBeDefined();
    expect(r.sueldoNeto).toBeUndefined();
  });
});

describe('calcularCostoTotal', () => {
  it('calcula bruto + noRem + contribuciones', () => {
    expect(calcularCostoTotal(ARANDA)).toBeCloseTo(1_028_347.29, 2);
  });
  it('devuelve null si falta bruto o contribuciones', () => {
    expect(calcularCostoTotal({ ...ARANDA, brutoRemunerativo: null })).toBeNull();
    expect(calcularCostoTotal({ ...ARANDA, contribucionesEmpleador: null })).toBeNull();
  });
});
