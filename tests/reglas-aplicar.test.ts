import { describe, it, expect } from 'vitest';
import { resolverAsignacionDeRegla } from '@/lib/reglas/aplicar';

const regBase = { categoriaId: 'cat1', distribucionId: null, centroCostoId: null, clienteId: null, proyectoId: null } as any;

describe('resolverAsignacionDeRegla', () => {
  it('línea única desde centroCostoId', async () => {
    const r = await resolverAsignacionDeRegla({} as any, { ...regBase, centroCostoId: 'cc1', clienteId: 'cl1' });
    expect(r.categoriaId).toBe('cat1');
    expect(r.lineas).toEqual([{ centroCostoId: 'cc1', clienteId: 'cl1', proyectoId: null, porcentaje: 100 }]);
  });
  it('desde plantilla de distribución', async () => {
    const db = { plantillaDistribucion: { findFirst: async () => ({ id: 'd1', lineas: [
      { centroCostoId: 'cc1', clienteId: null, proyectoId: 'p1', porcentaje: '60' },
      { centroCostoId: 'cc2', clienteId: null, proyectoId: null, porcentaje: '40' },
    ] }) } } as any;
    const r = await resolverAsignacionDeRegla(db, { ...regBase, distribucionId: 'd1' });
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[0]).toEqual({ centroCostoId: 'cc1', clienteId: null, proyectoId: 'p1', porcentaje: 60 });
  });
  it('sin distribución ni centro → líneas vacías', async () => {
    const r = await resolverAsignacionDeRegla({} as any, { ...regBase });
    expect(r.lineas).toEqual([]);
  });
});
