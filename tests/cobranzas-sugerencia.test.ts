import { describe, it, expect } from 'vitest';
import { identificarCliente, sugerirCombinacion } from '@/lib/cobranzas/sugerencia';

const clientes = [
  { id: 'comnet', cuit: '30661571663', razonSocial: 'COMNET S A', descriptores: [] },
  { id: 'mutual', cuit: '30686239973', razonSocial: 'ASOCIACION MUTUAL DEL PERSONAL DE EMISORAS', descriptores: ['pago a proveedores recibido aso mut del per y emis de'] },
  { id: 'kawellu', cuit: '30718332148', razonSocial: 'KAWELLU SOLUCIONES S.R.L.', descriptores: [] },
];

describe('identificarCliente', () => {
  it('por CUIT dentro del descriptor', () => {
    expect(identificarCliente('Transferencia recibida - credin Id debin lmorz cuit 30661571663', clientes)).toBe('comnet');
  });
  it('por descriptor aprendido o por nombre', () => {
    expect(identificarCliente('Pago a proveedores recibido Aso. mut. del per. y emis. de 3068', clientes)).toBe('mutual');
    expect(identificarCliente('Credito transf online banking emp De kawellu soluciones srl / factura', clientes)).toBe('kawellu');
  });
  it('sin pistas no adivina', () => {
    expect(identificarCliente('Comex - cobro exportacion de serv', clientes)).toBeNull();
  });
});

describe('sugerirCombinacion', () => {
  const f = (id: string, saldoArs: number | null) => ({ id, saldoArs });
  it('una factura exacta', () => {
    expect(sugerirCombinacion(1000, [f('a', 500), f('b', 1000), f('c', 300)])).toEqual(['b']);
  });
  it('dos o tres facturas que suman el crédito', () => {
    expect(sugerirCombinacion(800, [f('a', 500), f('b', 999), f('c', 300)])?.sort()).toEqual(['a', 'c']);
    expect(sugerirCombinacion(900, [f('a', 500), f('b', 100), f('c', 300), f('d', 5000)])?.sort()).toEqual(['a', 'b', 'c']);
  });
  it('neto de retenciones (Comnet: 1,65% menos)', () => {
    expect(sugerirCombinacion(14886621.17, [f('685', 15136816.51), f('687', 14520000)])).toEqual(['685']);
  });
  it('la exacta gana a la neta, y menos facturas gana', () => {
    expect(sugerirCombinacion(1000, [f('neta', 1020), f('x', 600), f('y', 400)])?.sort()).toEqual(['x', 'y']);
    expect(sugerirCombinacion(1000, [f('una', 1000), f('x', 600), f('y', 400)])).toEqual(['una']);
  });
  it('nada que explique el monto, o saldos sin TC', () => {
    expect(sugerirCombinacion(1000, [f('a', 2000), f('b', null)])).toBeNull();
    expect(sugerirCombinacion(1000, [])).toBeNull();
  });
});
