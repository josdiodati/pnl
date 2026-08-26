import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb, type ScopedDb } from '@/lib/empresa/scope';
import { validarPertenenciaLineas } from '@/lib/movimientos/service';
import { DomainError } from '@/lib/errors';

// Árbol de asignación: Centro de costo → Cliente → Proyecto. Un cliente
// clasificado sólo vale bajo su centro; un proyecto clasificado sólo bajo su
// cliente. Los NO clasificados (sin padre) valen en cualquier combinación.

describe('jerarquía centro→cliente→proyecto (integración contra la base)', () => {
  const sufijo = `arbol-${Date.now()}`;
  let empresaId: string;
  let db: ScopedDb;
  let bpo: string;
  let adm: string;
  let verizon: string; // cliente de BPO
  let libre: string; // cliente sin clasificar
  let vzAudit: string; // proyecto de Verizon
  let generico: string; // proyecto sin clasificar

  beforeAll(async () => {
    const empresa = await prisma.empresa.create({
      data: { slug: sufijo, razonSocial: 'Árbol SA', cuit: '30714325651' },
    });
    empresaId = empresa.id;
    db = scopedDb(empresaId);
    bpo = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } })).id;
    adm = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Adm', tipo: 'SOPORTE' } })).id;
    verizon = (await prisma.cliente.create({ data: { empresaId, nombre: 'Verizon', centroCostoId: bpo } })).id;
    libre = (await prisma.cliente.create({ data: { empresaId, nombre: 'Libre' } })).id;
    vzAudit = (await prisma.proyecto.create({ data: { empresaId, nombre: 'Vz Audit', clienteId: verizon } })).id;
    generico = (await prisma.proyecto.create({ data: { empresaId, nombre: 'Genérico' } })).id;
  });

  afterAll(async () => {
    await prisma.proyecto.deleteMany({ where: { empresaId } });
    await prisma.cliente.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
  });

  const linea = (centroCostoId: string, clienteId: string | null = null, proyectoId: string | null = null) => [
    { centroCostoId, clienteId, proyectoId, porcentaje: 100 },
  ];

  it('acepta combinaciones que respetan el árbol', async () => {
    await expect(validarPertenenciaLineas(db, linea(bpo, verizon, vzAudit))).resolves.toBeUndefined();
    await expect(validarPertenenciaLineas(db, linea(bpo, verizon))).resolves.toBeUndefined();
    await expect(validarPertenenciaLineas(db, linea(adm))).resolves.toBeUndefined();
  });

  it('los no clasificados valen en cualquier combinación', async () => {
    await expect(validarPertenenciaLineas(db, linea(adm, libre, generico))).resolves.toBeUndefined();
    await expect(validarPertenenciaLineas(db, linea(bpo, verizon, generico))).resolves.toBeUndefined();
  });

  it('rechaza un cliente clasificado bajo otro centro', async () => {
    await expect(validarPertenenciaLineas(db, linea(adm, verizon))).rejects.toThrow(DomainError);
  });

  it('rechaza un proyecto clasificado bajo otro cliente (o sin cliente)', async () => {
    await expect(validarPertenenciaLineas(db, linea(bpo, libre, vzAudit))).rejects.toThrow(DomainError);
    await expect(validarPertenenciaLineas(db, linea(bpo, null, vzAudit))).rejects.toThrow(DomainError);
  });
});
