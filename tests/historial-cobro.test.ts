import { describe, it, expect } from 'vitest';
import { formatearHistorialCobro, diffEdicion } from '@/lib/historial/cobro';

const ev = (accion: string, antes: unknown, despues: unknown, usuarioId: string | null = 'u1') => ({
  id: accion, accion, usuarioId, antes, despues, createdAt: new Date('2026-09-01T12:00:00Z'),
});
const refs = { usuarios: new Map([['u1', 'Ana'], ['u2', 'Beto']]), ventas: new Map([['v1', 'FACTURA A 00002-10']]) };

describe('historial de un cobro', () => {
  it('alta con actor, instrumentos, banco y facturas', () => {
    const [e] = formatearHistorialCobro([
      ev('COBRO_REGISTRAR', null, {
        origen: 'MANUAL', ventas: ['v1'], nota: 'recibo 4',
        instrumentos: [{ instrumento: 'TRANSFERENCIA', monto: 1000, moneda: 'ARS', fecha: '2026-08-05T00:00:00.000Z', fechaAcreditacion: '2026-08-05T00:00:00.000Z', numero: null, banco: 'Galicia' }],
      }),
    ], refs);
    expect(e.actor).toBe('Ana');
    expect(e.titulo).toBe('Cobro cargado');
    expect(e.detalles[0]).toContain('Transferencia');
    expect(e.detalles[0]).toContain('Galicia');
    expect(e.detalles).toContain('Aplicado a FACTURA A 00002-10');
    expect(e.detalles).toContain('Nota: recibo 4');
  });

  it('edición: diff por instrumento, agregados, quitados y nota', () => {
    const antes = {
      nota: null, cotizacion: null,
      instrumentos: [
        { cobroId: 'c1', instrumento: 'TRANSFERENCIA', monto: 1000, moneda: 'ARS', banco: null, numero: null },
        { cobroId: 'c2', instrumento: 'EFECTIVO', monto: 50, moneda: 'ARS' },
      ],
    };
    const despues = {
      nota: 'x', cotizacion: null,
      instrumentos: [
        { cobroId: 'c1', instrumento: 'TRANSFERENCIA', monto: 900, moneda: 'ARS', banco: 'Nación', numero: null },
        { instrumento: 'RETENCION', monto: 100, moneda: 'ARS' },
      ],
    };
    const d = diffEdicion(antes, despues);
    expect(d[0]).toMatch(/^Transferencia: monto: .*1\.000,00 → .*900,00; banco: — → Nación$/);
    expect(d[1]).toMatch(/^Agregado: Retención/);
    expect(d).toContain('nota: — → x');
    expect(d.some((x) => x.startsWith('Quitado: Efectivo'))).toBe(true);
    const [e] = formatearHistorialCobro([ev('COBRO_EDITAR', antes, despues, 'u2')], refs);
    expect(e.actor).toBe('Beto');
    expect(e.titulo).toBe('Cobro editado');
  });

  it('eventos del sistema y de cheques/resumen', () => {
    const items = formatearHistorialCobro([
      ev('COBRO_CHEQUE_ACREDITAR', { estado: 'EN_CARTERA' }, { estado: 'ACREDITADO', fechaAcreditacion: '2026-09-16T00:00:00.000Z' }),
      ev('COBRO_CONFIRMAR_RESUMEN', null, { descriptor: 'TRANSF COMNET' }, null),
    ], refs);
    expect(items[0].titulo).toMatch(/acreditado/);
    expect(items[1].actor).toBe('Sistema');
    expect(items[1].detalles[0]).toContain('TRANSF COMNET');
  });
});
