import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { contarPaginasPdf, textoDePagina } from '@/lib/empleados/pdf';

const PDF = readFileSync(join(process.cwd(), 'Docs/RecibosSueldoEwwo/Recibos_Ewwo Consulting SRL_2026-08.pdf'));

describe('pdf de recibos', () => {
  it('cuenta las 13 páginas del PDF real', async () => {
    expect(await contarPaginasPdf(PDF)).toBe(13);
  });

  it('extrae el texto de una página puntual (1-based)', async () => {
    const p4 = await textoDePagina(PDF, 4);
    expect(p4).toContain('FAZZINI');
    const p12 = await textoDePagina(PDF, 12);
    expect(p12).toContain('GODOY');
  });

  it('devuelve null para una página inexistente', async () => {
    expect(await textoDePagina(PDF, 99)).toBeNull();
  });

  it('devuelve null si el buffer no es un PDF', async () => {
    expect(await textoDePagina(Buffer.from('no soy un pdf'), 1)).toBeNull();
  });
});
