import { describe, it, expect } from 'vitest';
import { agruparArchivos, type JobRecibo, type ReciboDeArchivo } from '@/lib/empleados/archivos';

// Log de archivos de recibos: jobs por página + recibos que nacieron de ellas.

const job = (key: string, pagina: number, estado: string, minuto: number, extra: Partial<JobRecibo> = {}): JobRecibo => ({
  id: `${key}-${pagina}`,
  estado,
  error: null,
  createdAt: new Date(Date.UTC(2026, 8, 30, 18, minuto)),
  payload: { archivoKey: key, archivoNombre: `${key}.pdf`, usuarioId: 'u1', pagina },
  ...extra,
});

const recibo = (key: string, pagina: number, estado: ReciboDeArchivo['estado'], mes = 9): ReciboDeArchivo => ({
  id: `r-${key}-${pagina}`, archivoKey: key, pagina, estado, empleadoNombre: `EMP ${pagina}`, anio: 2026, mes,
});

describe('agruparArchivos', () => {
  it('agrupa por archivo, cuenta estados por página y ordena lo más nuevo primero', () => {
    const jobs = [
      job('a', 2, 'done', 1), job('a', 1, 'done', 1), job('a', 3, 'failed', 1, { error: 'sin CUIL' }),
      job('a', 4, 'queued', 1), job('a', 5, 'done', 1),
      job('b', 1, 'done', 5),
    ];
    const recibos = [recibo('a', 1, 'CONFIRMADO'), recibo('a', 2, 'PENDIENTE_REVISION', 8), recibo('b', 1, 'ANULADO')];
    const [b, a] = agruparArchivos(jobs, recibos);

    expect(b.archivoKey).toBe('b');
    expect(b.conteo.ANULADO).toBe(1);
    expect(b.periodos).toEqual([]); // los anulados no cuentan como período cargado

    expect(a.paginas.map((p) => p.pagina)).toEqual([1, 2, 3, 4, 5]);
    expect(a.paginas.map((p) => p.estado)).toEqual(['CONFIRMADO', 'PENDIENTE_REVISION', 'FALLIDA', 'EN_COLA', 'SIN_RECIBO']);
    expect(a.paginas[2].error).toBe('sin CUIL');
    expect(a.usuarioId).toBe('u1');
    expect(a.archivoNombre).toBe('a.pdf');
    expect(a.periodos).toEqual([{ anio: 2026, mes: 9, cantidad: 1 }, { anio: 2026, mes: 8, cantidad: 1 }]);
  });

  it('ignora jobs sin archivo o sin página', () => {
    expect(agruparArchivos([{ id: 'x', estado: 'done', error: null, createdAt: new Date(), payload: {} }], [])).toEqual([]);
  });
});
