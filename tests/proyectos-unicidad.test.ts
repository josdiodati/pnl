import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { proyectoDuplicado } from '@/lib/proyectos';

// El nombre de proyecto NO es único por sí solo: lo único es el combo
// (cliente, nombre) dentro de la empresa. "Web" puede existir para dos
// clientes distintos; lo que no puede repetirse es "Web" bajo el mismo
// cliente, ni dos "Web" sin clasificar (los NULL no chocan en el índice
// de Postgres, así que ese caso lo cubre proyectoDuplicado en la action).
describe('unicidad de proyectos por (cliente, nombre)', () => {
  const sufijo = `pu-${Date.now()}`;
  let empresaId: string;
  let clienteA: string;
  let clienteB: string;

  beforeAll(async () => {
    const e = await prisma.empresa.create({
      data: { slug: `proy-uni-${sufijo}`, razonSocial: 'Proyectos Unicidad', cuit: '30714325651' },
    });
    empresaId = e.id;
    const a = await prisma.cliente.create({ data: { empresaId, nombre: `Cliente A ${sufijo}` } });
    const b = await prisma.cliente.create({ data: { empresaId, nombre: `Cliente B ${sufijo}` } });
    clienteA = a.id;
    clienteB = b.id;
  });

  afterAll(async () => {
    await prisma.proyecto.deleteMany({ where: { empresaId } });
    await prisma.cliente.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.$disconnect();
  });

  it('permite el mismo nombre bajo clientes distintos', async () => {
    const db = scopedDb(empresaId);
    await db.proyecto.create({ data: { nombre: 'Web', clienteId: clienteA } as never });
    await expect(
      db.proyecto.create({ data: { nombre: 'Web', clienteId: clienteB } as never }),
    ).resolves.toMatchObject({ nombre: 'Web', clienteId: clienteB });
  });

  it('rechaza el mismo nombre bajo el mismo cliente (índice único)', async () => {
    const db = scopedDb(empresaId);
    await expect(
      db.proyecto.create({ data: { nombre: 'Web', clienteId: clienteA } as never }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('proyectoDuplicado detecta el duplicado sin clasificar (NULL no choca en el índice)', async () => {
    const db = scopedDb(empresaId);
    await db.proyecto.create({ data: { nombre: 'Interno', clienteId: null } as never });
    expect(await proyectoDuplicado(db, { nombre: 'Interno', clienteId: null })).toBe(true);
    expect(await proyectoDuplicado(db, { nombre: 'Interno', clienteId: clienteA })).toBe(false);
    expect(await proyectoDuplicado(db, { nombre: 'Otro', clienteId: null })).toBe(false);
  });

  it('proyectoDuplicado ignora al propio registro al editar', async () => {
    const db = scopedDb(empresaId);
    const p = await db.proyecto.findFirst({ where: { nombre: 'Interno' } });
    expect(await proyectoDuplicado(db, { nombre: 'Interno', clienteId: null, ignorarId: p!.id })).toBe(false);
  });
});
