import { describe, it, expect } from 'vitest';
import { netoPrepaga, netoComputable, aportesObraSocialDeConceptos } from '@/lib/empleados/prepaga';

// Costo real de la prepaga por empleado: plan − FSR% × (aportes + contribuciones).
// A la prepaga sólo llega el 85% de los aportes/contribuciones (el FSR retiene
// el resto). Si el neto da negativo, en reportes computa 0 (no descuenta).

describe('netoPrepaga', () => {
  it('plan − 85% de (aportes + contribuciones), en centavos', () => {
    // Caso Galeno real: plan 264.175,80; aportes+contrib de la OS del empleado
    const neto = netoPrepaga({ costoPlan: 264175.8, aportes: 137843.95, contribuciones: 243270, fsrPct: 85 });
    expect(neto).toBe(Math.round(264175.8 * 100) - Math.round((137843.95 + 243270) * 0.85 * 100));
  });

  it('respeta un FSR distinto', () => {
    expect(netoPrepaga({ costoPlan: 1000, aportes: 500, contribuciones: 500, fsrPct: 100 })).toBe(0);
  });

  it('puede dar negativo (los aportes superan el plan)', () => {
    const neto = netoPrepaga({ costoPlan: 100, aportes: 500, contribuciones: 500, fsrPct: 85 });
    expect(neto).toBeLessThan(0);
    expect(netoComputable({ costoPlan: 100, aportes: 500, contribuciones: 500, fsrPct: 85 })).toBe(0);
  });

  it('netoComputable devuelve el neto cuando es positivo', () => {
    expect(netoComputable({ costoPlan: 1000, aportes: 100, contribuciones: 100, fsrPct: 85 })).toBe(
      netoPrepaga({ costoPlan: 1000, aportes: 100, contribuciones: 100, fsrPct: 85 }),
    );
  });
});

describe('aportesObraSocialDeConceptos (precarga desde el recibo)', () => {
  const conceptos = [
    { concepto: 'Sueldo Mensual', unidad: '31', importe: 4770000, naturaleza: 'REMUNERATIVO' },
    { concepto: 'Jubilacion 11%', unidad: null, importe: 505427.81, naturaleza: 'RETENCION' },
    { concepto: 'Ley 19032 3%', unidad: null, importe: 137843.95, naturaleza: 'RETENCION' },
    { concepto: 'Obra Social 3%', unidad: null, importe: 137843.95, naturaleza: 'RETENCION' },
    { concepto: 'Contribución de Seg. Social', unidad: '18,90%', importe: 900269.34, naturaleza: 'CONTRIBUCION_EMPLEADOR' },
    { concepto: 'Contribución de Obra Social', unidad: '5,10%', importe: 243270, naturaleza: 'CONTRIBUCION_EMPLEADOR' },
    { concepto: 'ART 1,63%', unidad: null, importe: 77751, naturaleza: 'CONTRIBUCION_EMPLEADOR' },
  ];

  it('separa el aporte del empleado y la contribución patronal de obra social', () => {
    const r = aportesObraSocialDeConceptos(conceptos);
    expect(r.aportes).toBe(137843.95);
    expect(r.contribuciones).toBe(243270);
  });

  it('sin conceptos de obra social devuelve ceros', () => {
    expect(aportesObraSocialDeConceptos([{ concepto: 'Sueldo', unidad: null, importe: 1, naturaleza: 'REMUNERATIVO' }])).toEqual({ aportes: 0, contribuciones: 0 });
    expect(aportesObraSocialDeConceptos(null)).toEqual({ aportes: 0, contribuciones: 0 });
  });
});
