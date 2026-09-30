import { describe, it, expect } from 'vitest';
import { ENCABEZADOS_EXPORT_ARCA, filasExportArca, parsearFiltrosArca, whereArca, type ComprobanteArcaExport } from '@/lib/arca/mis-comprobantes/exportar';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function arca(p: Partial<ComprobanteArcaExport> = {}): ComprobanteArcaExport {
  return {
    origen: 'RECIBIDO', fechaEmision: d('2026-08-10'), tipoComprobante: 81, puntoVenta: 17, numeroDesde: 8027,
    nroDocContraparte: '30646717473', denominacionContraparte: 'PROVEEDOR SA', moneda: '$', tipoCambio: 1,
    netoGravadoTotal: 111574.39, netoNoGravado: 0, exentas: 0, otrosTributos: 0, totalIva: 23430.62, importeTotal: 135005.01,
    codigoAutorizacion: null, movimientoId: null, ignoradoAt: null, motivoIgnorado: null, ignoradoPor: null, movimiento: null,
    ...p,
  };
}

const col = (fila: unknown[], nombre: string) => fila[ENCABEZADOS_EXPORT_ARCA.indexOf(nombre)];

describe('exportación de ARCA', () => {
  it('una fila cruzada trae los datos del comprobante de PNL, la diferencia de total y el link', () => {
    const [fila] = filasExportArca([
      arca({
        movimientoId: 'mov1',
        movimiento: {
          id: 'mov1', estado: 'ASIGNADO', fechaDevengamiento: d('2026-08-10'), tipoComprobante: 'FACTURA_A', puntoVenta: '00017', numero: '00008027',
          cuitEmisor: '30646717473', descripcion: 'Almuerzo', moneda: 'ARS', tipoCambio: null, netoGravado: 111574.39,
          iva105: null, iva21: 23430.62, iva27: null, total: 135000, cae: null,
          contraparte: { cuit: '30646717473', razonSocial: 'Proveedor S.A.' }, categoria: { nombre: 'Viáticos' },
        },
      }),
    ], 'https://pnl.ledger.ar', 'ewwo');
    expect(fila).toHaveLength(ENCABEZADOS_EXPORT_ARCA.length);
    expect(col(fila, 'tipo')).toBe('Tique factura A');
    expect(col(fila, 'numero')).toBe('00017-00008027');
    expect(col(fila, 'estado_en_pnl')).toBe('Cruzado');
    expect(col(fila, 'pnl_tipo')).toBe('FACTURA_A');
    expect(col(fila, 'pnl_numero')).toBe('00017-00008027');
    expect(col(fila, 'pnl_contraparte')).toBe('Proveedor S.A.');
    expect(col(fila, 'pnl_categoria')).toBe('Viáticos');
    expect(col(fila, 'pnl_iva')).toBe(23430.62);
    expect(col(fila, 'pnl_total')).toBe(135000);
    expect(col(fila, 'diferencia_total')).toBe(5.01);
    expect(col(fila, 'pnl_link')).toBe('https://pnl.ledger.ar/ewwo/validacion/mov1');
  });

  it('ignorado trae motivo, quién y cuándo; faltante deja vacías las columnas de PNL', () => {
    const [ign, falta] = filasExportArca([
      arca({ ignoradoAt: d('2026-09-30'), motivoIgnorado: 'No lo entregan', ignoradoPor: { nombre: 'José' } }),
      arca(),
    ], 'https://x', 'ewwo');
    expect([col(ign, 'estado_en_pnl'), col(ign, 'motivo_ignorado'), col(ign, 'ignorado_por'), col(ign, 'ignorado_el')]).toEqual(['Ignorado', 'No lo entregan', 'José', '2026-09-30']);
    expect(col(falta, 'estado_en_pnl')).toBe('Falta en PNL');
    expect(col(falta, 'pnl_total')).toBeNull();
    expect(col(falta, 'pnl_link')).toBeNull();
  });

  it('no calcula diferencia entre monedas distintas', () => {
    const [fila] = filasExportArca([
      arca({
        moneda: 'USD', importeTotal: 100, movimientoId: 'm',
        movimiento: { id: 'm', estado: 'VALIDADO', fechaDevengamiento: null, tipoComprobante: 'FACTURA_E', puntoVenta: '2', numero: '1', cuitEmisor: null, descripcion: null, moneda: 'ARS', tipoCambio: null, netoGravado: null, iva105: null, iva21: null, iva27: null, total: 100000, cae: null, contraparte: null, categoria: null },
      }),
    ], 'https://x', 'ewwo');
    expect(col(fila, 'diferencia_total')).toBeNull();
  });

  it('filtros: los mismos que la pantalla', () => {
    expect(parsearFiltrosArca({}, '2026-09')).toEqual({ mes: '2026-09', origen: undefined, estado: 'todos' });
    expect(parsearFiltrosArca({ mes: 'todos', origen: 'RECIBIDO', estado: 'ignorados' }, '2026-09')).toEqual({ mes: 'todos', origen: 'RECIBIDO', estado: 'ignorados' });
    expect(whereArca({ mes: 'todos', estado: 'faltantes' })).toEqual({ movimientoId: null, ignoradoAt: null });
    expect(whereArca({ mes: '2026-08', origen: 'EMITIDO', estado: 'cruzados' })).toEqual({
      origen: 'EMITIDO', movimientoId: { not: null }, fechaEmision: { gte: d('2026-08-01'), lt: d('2026-09-01') },
    });
  });
});
