import { describe, it, expect } from 'vitest';
import { buildWhereComprobantes, resumirComprobantes, type ComprobanteResumible } from '@/lib/comprobantes/query';

const opts = { esValidador: true, usuarioId: 'u1' };
const json = (x: unknown) => JSON.stringify(x);

describe('buildWhereComprobantes', () => {
  it('por defecto: sólo compras y sin duplicados ni anulados', () => {
    const w = json(buildWhereComprobantes({}, opts));
    expect(w).toContain('"origen":{"in":["COMPROBANTE"]}');
    expect(w).toContain('"notIn":["DUPLICADO","ANULADO"]');
  });
  it('un estado explícito reemplaza al default (se pueden ver los duplicados)', () => {
    const w = json(buildWhereComprobantes({ estado: 'DUPLICADO' }, opts));
    expect(w).toContain('"estado":"DUPLICADO"');
    expect(w).not.toContain('notIn');
  });
  it('el lado elige compras, ventas o ambos; los ids restringen (drill-down)', () => {
    expect(json(buildWhereComprobantes({}, opts))).toContain('"origen":{"in":["COMPROBANTE"]}');
    expect(json(buildWhereComprobantes({ lado: 'ventas' }, opts))).toContain('"origen":{"in":["VENTA_COMPROBANTE","VENTA_MANUAL"]}');
    expect(json(buildWhereComprobantes({ lado: 'todos' }, opts))).toContain('"in":["COMPROBANTE","VENTA_COMPROBANTE","VENTA_MANUAL"]');
    expect(json(buildWhereComprobantes({ lado: 'otro' }, opts))).toContain('"origen":{"in":["COMPROBANTE"]}');
    expect(json(buildWhereComprobantes({}, { ...opts, ids: ['a', 'b'] }))).toContain('"id":{"in":["a","b"]}');
  });
  it('un cargador sólo ve lo suyo', () => {
    expect(json(buildWhereComprobantes({}, { esValidador: false, usuarioId: 'u9' }))).toContain('"creadoPorId":"u9"');
  });
  it('el buscador cubre proveedor, CUIT con o sin guiones, número, archivo y el texto del documento', () => {
    const w = json(buildWhereComprobantes({ q: '30-66157166-3' }, opts));
    expect(w).toContain('"razonSocial":{"contains":"30-66157166-3"');
    expect(w).toContain('{"cuitEmisor":{"contains":"30661571663"}}');
    expect(w).toContain('"path":["textoDocumento"]');
    expect(w).toContain('"archivoNombre"');
  });
  it('filtros de problema y sin categoría', () => {
    expect(json(buildWhereComprobantes({ problema: 'qr' }, opts))).toContain('"qrEstado":{"in":["ILEGIBLE","SIN_QR"]}');
    expect(json(buildWhereComprobantes({ categoriaId: 'sin' }, opts))).toContain('"categoriaId":null');
    expect(json(buildWhereComprobantes({ problema: 'inventado' }, opts))).not.toContain('inventado');
  });
});

const fila = (over: Partial<ComprobanteResumible>): ComprobanteResumible => ({
  estado: 'ASIGNADO', moneda: 'ARS', tipoCambio: null, tipoComprobante: 'FACTURA_A', total: 121, netoGravado: 100,
  iva21: 21, iva105: null, iva27: null, percepcionesIva: null, percepcionesIibb: null, otrosTributos: null, proveedor: 'Edesur', ...over,
});

describe('resumirComprobantes', () => {
  it('suma total, IVA crédito fiscal y neto; la NC resta; duplicados y anulados no suman', () => {
    const r = resumirComprobantes([
      fila({}),
      fila({ tipoComprobante: 'NOTA_CREDITO_A', total: 12.1, iva21: 2.1 }),
      fila({ estado: 'DUPLICADO' }),
      fila({ estado: 'ANULADO' }),
      fila({ total: 110, iva21: null, percepcionesIibb: 10, proveedor: 'Telecom' }),
    ]);
    expect(r.cantidad).toBe(5);
    expect(r.totalArs).toBe(218.9);
    expect(r.ivaArs).toBe(18.9);
    expect(r.percepcionesArs).toBe(10);
    expect(r.netoArs).toBe(190);
    expect(r.topProveedores[0]).toEqual({ proveedor: 'Telecom', totalArs: 110, cantidad: 1 });
  });
  it('pesifica al TC y separa lo que no tiene TC', () => {
    const r = resumirComprobantes([fila({ moneda: 'USD', tipoCambio: 1000, total: 10, iva21: null }), fila({ moneda: 'USD', tipoCambio: null })]);
    expect(r.totalArs).toBe(10000);
    expect(r.sinTipoCambio).toBe(1);
  });
});
