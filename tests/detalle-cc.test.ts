import { describe, it, expect } from 'vitest';
import { rangoDetalle, filasExportDetalle, type TextosDetalle } from '@/lib/reportes-personalizados/detalle-cc';
import { agruparDesglose, desglosarCentro, type MovimientoDesglose } from '@/lib/reportes-personalizados/desglose-centro';

// Detalle CC: rango desde/hasta y filas del exportable (lo que se ve en
// pantalla, sin aclarar a qué centros va el resto de un documento repartido).

describe('rangoDetalle', () => {
  const hoy = new Date(Date.UTC(2026, 9, 2)); // 2-oct-2026

  it('por defecto: del primer mes del ejercicio corriente al mes actual', () => {
    expect(rangoDetalle({}, hoy, 7)).toMatchObject({ desde: '2026-07', hasta: '2026-10' });
    expect(rangoDetalle({}, hoy, 7).meses).toEqual([
      { anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }, { anio: 2026, mes: 9 }, { anio: 2026, mes: 10 },
    ]);
    // Ejercicio calendario.
    expect(rangoDetalle({}, hoy, 1)).toMatchObject({ desde: '2026-01', hasta: '2026-10' });
    // Ejercicio que empezó el año anterior.
    expect(rangoDetalle({}, new Date(Date.UTC(2027, 1, 10)), 7)).toMatchObject({ desde: '2026-07', hasta: '2027-02' });
  });

  it('toma desde/hasta YYYY-MM, cruza años y los ordena si vienen invertidos', () => {
    const r = rangoDetalle({ desde: '2025-11', hasta: '2026-02' }, hoy, 7);
    expect(r.meses.map((m) => `${m.anio}-${m.mes}`)).toEqual(['2025-11', '2025-12', '2026-1', '2026-2']);
    expect(rangoDetalle({ desde: '2026-09', hasta: '2026-08' }, hoy, 7)).toMatchObject({ desde: '2026-08', hasta: '2026-09' });
  });

  it('valores inválidos caen al defecto; el rango se limita a 36 meses (los últimos)', () => {
    expect(rangoDetalle({ desde: 'basura', hasta: '2026-13' }, hoy, 7)).toMatchObject({ desde: '2026-07', hasta: '2026-10' });
    const largo = rangoDetalle({ desde: '2020-01', hasta: '2026-12' }, hoy, 7);
    expect(largo.meses).toHaveLength(36);
    expect(largo.desde).toBe('2024-01');
  });
});

describe('filasExportDetalle', () => {
  const sep = { anio: 2026, mes: 9 };
  const mov = (id: string, lineas: MovimientoDesglose['lineas']): MovimientoDesglose => ({
    id, ...sep, categoriaId: 'hosting', tipoCategoria: 'EGRESO', esCostoPersonal: false, tipoComprobante: 'FACTURA_A',
    moneda: 'ARS', tipoCambio: null, total: 1000, iva21: null, iva105: null, iva27: null,
    percepcionesIva: null, percepcionesIibb: null, otrosTributos: null, lineas,
  });
  const meses = [sep];
  const movimientos = [
    mov('m1', [{ centroCostoId: 'shared', porcentaje: 50 }, { centroCostoId: 'bpo', porcentaje: 50 }]),
    mov('m2', [{ centroCostoId: 'shared', porcentaje: 100 }]),
  ];
  const d = desglosarCentro({ meses, centroId: 'shared', movimientos, recibos: [] });
  const textos: TextosDetalle = {
    describir: (f) => ({ documento: `FACTURA A ${f.id}`, concepto: 'Proveedor X' }),
    nombreCategoria: () => 'Hosting',
    nombreCentro: () => '?',
    criterioDe: () => null,
    criterioCentro: null,
  };

  it('replica secciones, categorías, ítems y resultado, en pesos y sin el "resto"', () => {
    const filas = filasExportDetalle(d, agruparDesglose(d.filas), textos);
    expect(filas.map((f) => f.nivel)).toEqual(['seccion', 'categoria', 'item', 'item', 'resultado']);
    expect(filas[0]).toMatchObject({ documento: 'Egresos operativos', importe: -1500 });
    expect(filas[1]).toMatchObject({ documento: 'Hosting', concepto: '2 ítems', importe: -1500 });
    const repartido = filas.find((f) => f.documento === 'FACTURA A m1')!;
    expect(repartido).toEqual({
      nivel: 'item', mes: 'sep 26', documento: 'FACTURA A m1', concepto: 'Proveedor X', detalle: '',
      neto: -1000, porcentaje: 50, importe: -500,
    });
    expect(JSON.stringify(filas)).not.toMatch(/resto|bpo/i);
    expect(filas[4]).toMatchObject({ documento: 'Resultado del período', importe: -1500 });
  });
});
