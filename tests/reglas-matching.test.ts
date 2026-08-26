import { describe, it, expect } from 'vitest';
import { reglaMatchea, elegirRegla, type EntradaRegla } from '@/lib/reglas/matching';

const base = {
  id: 'r', empresaId: 'e', nombre: 'x', prioridad: 100, activa: true,
  cargadoPorId: null, cuit: null, canal: null, palabraClave: null,
  categoriaId: 'c1', distribucionId: null, centroCostoId: 'cc1', clienteId: null, proyectoId: null,
  createdAt: new Date(0), updatedAt: new Date(0),
} as any;
const e: EntradaRegla = { creadoPorId: 'u1', cuitContraparte: '30711111118', canalIngreso: 'WEB', texto: 'ypf combustible nafta' };

describe('reglaMatchea', () => {
  it('sin condiciones NO matchea', () => {
    expect(reglaMatchea({ ...base }, e)).toBe(false);
  });
  it('AND de condiciones seteadas', () => {
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1' }, e)).toBe(true);
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1', canal: 'EMAIL' }, e)).toBe(false);
    expect(reglaMatchea({ ...base, cargadoPorId: 'u1', canal: 'WEB' }, e)).toBe(true);
  });
  it('cuit normaliza', () => {
    expect(reglaMatchea({ ...base, cuit: '30-71111111-8' }, e)).toBe(true);
  });
  it('palabraClave case-insensitive substring', () => {
    expect(reglaMatchea({ ...base, palabraClave: 'COMBUSTIBLE' }, e)).toBe(true);
    expect(reglaMatchea({ ...base, palabraClave: 'peaje' }, e)).toBe(false);
  });
  it('regla inactiva nunca participa en elegirRegla', () => {
    expect(elegirRegla([{ ...base, cargadoPorId: 'u1', activa: false }], e)).toBeNull();
  });
  it('elegirRegla devuelve la de menor prioridad', () => {
    const r1 = { ...base, cargadoPorId: 'u1', prioridad: 50, nombre: 'a' };
    const r2 = { ...base, cargadoPorId: 'u1', prioridad: 10, nombre: 'b' };
    expect(elegirRegla([r1, r2], e)?.nombre).toBe('b');
  });
});
