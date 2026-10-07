import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { mapaConciliacion, idsPorGradoConciliacion } from '@/lib/resumenes/conciliacion-comprobante';
import { buildWhereComprobantes } from '@/lib/comprobantes/query';

// Tag «Conciliado» de Comprobantes contra la base: el mapa de una página, el
// filtro completa/parcial (ids) y ninguna (where), y el aislamiento por empresa.

describe('conciliación de comprobantes con resúmenes (integración)', () => {
  const sufijo = `concomp-${Date.now()}`;
  const empresas: string[] = [];
  let db: ReturnType<typeof scopedDb>;
  let usuarioId: string;
  const ids = { completo: '', parcial: '', ninguno: '', pendiente: '', ajeno: '' };

  async function armarEmpresa(n: number) {
    const empresa = await prisma.empresa.create({ data: { slug: `${sufijo}-${n}`, razonSocial: `Concomp ${n} SA`, cuit: `3071432565${n}` } });
    empresas.push(empresa.id);
    const periodo = await prisma.periodo.create({ data: { empresaId: empresa.id, anio: 2031, mes: 6 } });
    const resumen = await prisma.resumen.create({
      data: { empresaId: empresa.id, tipo: 'TARJETA', emisor: 'Visa Test', periodoId: periodo.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}-${n}` },
    });
    const comp = (total: number) =>
      prisma.movimiento.create({
        data: { empresaId: empresa.id, origen: 'COMPROBANTE', estado: 'ASIGNADO', total, creadoPorId: usuarioId, fechaDevengamiento: new Date('2031-06-05T00:00:00Z'), periodoId: periodo.id },
      });
    const vincular = async (movimientoId: string, monto: number, estado = 'CONCILIADA', cuotas: string | null = null) => {
      const l = await prisma.resumenLinea.create({
        data: { resumenId: resumen.id, orden: 1, descriptor: 'PROVEEDOR', monto: -monto, moneda: 'ARS', estado, cuotas, fecha: new Date('2031-06-10T00:00:00Z') } as never,
      });
      await prisma.resumenLineaVinculo.create({ data: { lineaId: l.id, movimientoId } });
    };
    return { empresa, comp, vincular };
  }

  beforeAll(async () => {
    usuarioId = (await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test', passwordHash: 'x' } })).id;
    const a = await armarEmpresa(1);
    ids.completo = (await a.comp(1000)).id;
    await a.vincular(ids.completo, 1000);
    ids.parcial = (await a.comp(3000)).id;
    await a.vincular(ids.parcial, 1000, 'CONCILIADA', '1/3');
    ids.ninguno = (await a.comp(500)).id;
    // Una línea SUGERIDA con vínculo no cuenta: todavía no se confirmó.
    ids.pendiente = (await a.comp(700)).id;
    await a.vincular(ids.pendiente, 700, 'SUGERIDA');
    db = scopedDb(a.empresa.id);

    const b = await armarEmpresa(2);
    ids.ajeno = (await b.comp(900)).id;
    await b.vincular(ids.ajeno, 900);
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId: { in: empresas } } } });
    await prisma.resumen.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.movimiento.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.periodo.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: empresas } } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('el mapa de la página gradúa cada comprobante con sus líneas confirmadas', async () => {
    const comps = await db.movimiento.findMany({ where: { id: { in: Object.values(ids) } } });
    const mapa = await mapaConciliacion(db, comps);
    expect(mapa.get(ids.completo)!.grado).toBe('COMPLETA');
    expect(mapa.get(ids.parcial)).toMatchObject({ grado: 'PARCIAL', cubierto: 1000, faltante: 2000 });
    expect(mapa.get(ids.parcial)!.lineas[0]).toMatchObject({ cuotas: '1/3', resumen: 'Visa Test · Junio 2031' });
    expect(mapa.get(ids.ninguno)!.grado).toBe('NINGUNA');
    expect(mapa.get(ids.pendiente)!.grado).toBe('NINGUNA');
    expect(mapa.has(ids.ajeno)).toBe(false); // otra empresa: ni siquiera entra en la consulta
  });

  it('el filtro completa/parcial devuelve sólo ids de la empresa', async () => {
    expect(await idsPorGradoConciliacion(db, 'COMPLETA')).toEqual([ids.completo]);
    expect(await idsPorGradoConciliacion(db, 'PARCIAL')).toEqual([ids.parcial]);
  });

  it('el filtro ninguna deja los comprobantes sin línea confirmada', async () => {
    const where = buildWhereComprobantes({ conciliacion: 'ninguna' }, { esValidador: true, usuarioId });
    const encontrados = await db.movimiento.findMany({ where, select: { id: true } });
    expect(encontrados.map((m) => m.id).sort()).toEqual([ids.ninguno, ids.pendiente].sort());
  });
});
