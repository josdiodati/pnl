import { describe, it, expect } from 'vitest';
import { verificarAritmeticaRecibo, calcularCostoTotal, avisosInformativos, leerTotal, type TotalesRecibo } from '@/lib/empleados/aritmetica';

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

// Recibo real de Ewwo (jun-2026): las "retenciones" fueron una devolución. Con
// el signo negativo el neto cierra al centavo.
const DEVOLUCION: TotalesRecibo = {
  brutoRemunerativo: 6_492_833.34,
  noRemunerativo: 0.93,
  retenciones: 518_551.73,
  sueldoNeto: 7_011_386,
  contribucionesEmpleador: 108_022.8,
  costoTotalEmpleador: 6_600_857.07,
};

describe('retenciones negativas (devolución)', () => {
  it('en positivo el neto no cierra; en negativo cierra', () => {
    expect(verificarAritmeticaRecibo(DEVOLUCION).sueldoNeto).toMatch(/no cierra/);
    expect(verificarAritmeticaRecibo({ ...DEVOLUCION, retenciones: -518_551.73 })).toEqual({});
  });
});

describe('avisosInformativos', () => {
  it('saca los avisos de cuenta (se recalculan en vivo) y deja los informativos', () => {
    const guardados = {
      ...verificarAritmeticaRecibo(DEVOLUCION),
      empleado: 'Empleado nuevo dado de alta desde el recibo',
    };
    expect(avisosInformativos(guardados, DEVOLUCION)).toEqual({ empleado: 'Empleado nuevo dado de alta desde el recibo' });
  });

  it('un aviso con el mismo campo pero otro texto es informativo', () => {
    const guardados = { costoTotalEmpleador: 'El recibo no imprime el costo total empleador: se calculó' };
    expect(avisosInformativos(guardados, FAZZINI)).toEqual(guardados);
  });
});

describe('leerTotal', () => {
  it('acepta formato es-AR, punto decimal y negativos; vacío o basura = null', () => {
    expect(leerTotal('-518.551,73')).toBe(-518551.73);
    expect(leerTotal('-518551.73')).toBe(-518551.73);
    expect(leerTotal('  ')).toBeNull();
    expect(leerTotal('abc')).toBeNull();
  });
});
