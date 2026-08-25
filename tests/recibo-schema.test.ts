import { describe, it, expect } from 'vitest';
import { reciboExtraccionSchema } from '@/lib/extractor/recibo-schema';

describe('reciboExtraccionSchema', () => {
  it('parsea una extracción completa (caso Ewwo)', () => {
    const r = reciboExtraccionSchema.parse({
      nombre: 'FAZZINI SANTIAGO OSCAR',
      cuil: '20253767872',
      legajo: '00000004',
      categoriaLaboral: 'PROJECT MANAGER',
      sector: null,
      fechaIngreso: '2016-06-01',
      periodoAnio: 2026,
      periodoMes: 8,
      tipo: 'MENSUAL',
      conceptos: [
        { concepto: 'Sueldo Mensual', unidad: '31', importe: 4770000, naturaleza: 'REMUNERATIVO' },
        { concepto: 'Jubilacion 11%', unidad: null, importe: 505427.81, naturaleza: 'RETENCION' },
        { concepto: 'Contribución de Seg. Social', unidad: '18,90%', importe: 900269.34, naturaleza: 'CONTRIBUCION_EMPLEADOR' },
      ],
      brutoRemunerativo: 4770000,
      noRemunerativo: 0.06,
      retenciones: 913186.06,
      sueldoNeto: 3856814,
      contribucionesEmpleador: 1223553.96,
      costoTotalEmpleador: 5993554.02,
      confianza: { cuil: 1 },
      observaciones: null,
    });
    expect(r.cuil).toBe('20253767872');
    expect(r.conceptos).toHaveLength(3);
  });

  it('aplica defaults en campos ausentes', () => {
    const r = reciboExtraccionSchema.parse({ nombre: null, cuil: null, periodoAnio: null, periodoMes: null });
    expect(r.tipo).toBe('MENSUAL');
    expect(r.conceptos).toEqual([]);
    expect(r.costoTotalEmpleador).toBeNull();
  });

  it('rechaza mes fuera de rango y naturaleza desconocida', () => {
    expect(() => reciboExtraccionSchema.parse({ nombre: null, cuil: null, periodoAnio: 2026, periodoMes: 13 })).toThrow();
    expect(() =>
      reciboExtraccionSchema.parse({
        nombre: null, cuil: null, periodoAnio: 2026, periodoMes: 1,
        conceptos: [{ concepto: 'X', importe: 1, naturaleza: 'OTRA_COSA' }],
      }),
    ).toThrow();
  });
});
