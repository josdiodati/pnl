import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { editarLinea, conciliarLinea } from '@/lib/resumenes/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';

// Corrección manual de una línea de resumen cuando el OCR/la captura falló:
// los datos extraídos se pueden editar mientras la línea no esté resuelta, la
// corrección queda auditada con el valor viejo, y el matching se recalcula
// (corregir el importe suele hacer aparecer el movimiento que corresponde).

describe('edición de líneas de resumen (integración)', () => {
  const sufijo = `edic-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let resumenId: string;
  let movExistente: string;
  const linea = async (datos: Record<string, unknown> = {}) =>
    prisma.resumenLinea.create({
      data: { resumenId, orden: 99, descriptor: 'LINEA TEST', monto: -1000, moneda: 'ARS', fecha: new Date('2031-05-10T00:00:00Z'), ...datos } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Edic', passwordHash: 'x' } });
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Edic SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    const periodo = await prisma.periodo.create({ data: { empresaId, anio: 2031, mes: 5 } });
    resumenId = (await prisma.resumen.create({
      data: { empresaId, tipo: 'TARJETA', emisor: 'Test', periodoId: periodo.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}` },
    })).id;
    movExistente = (await prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'ASIGNADO', total: 5000, creadoPorId: usuario.id, fechaDevengamiento: new Date('2031-05-09T00:00:00Z'), periodoId: periodo.id },
    })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('corrige los datos capturados de la línea', async () => {
    const l = await linea({ descriptor: 'MERC4D0 L1BRE', cuotas: null, cuenta: null, titular: null });
    await editarLinea(ctx, {
      lineaId: l.id,
      descriptor: 'MERCADO LIBRE',
      fecha: new Date('2031-05-12T00:00:00Z'),
      monto: -1234.56,
      moneda: 'USD',
      montoOrigen: -10,
      cuotas: '3/6',
      cuenta: '4517',
      titular: 'JUAN PEREZ',
    });
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.descriptor).toBe('MERCADO LIBRE');
    expect(actual!.fecha!.toISOString()).toBe('2031-05-12T00:00:00.000Z');
    expect(Number(actual!.monto)).toBeCloseTo(-1234.56, 2);
    expect(actual!.moneda).toBe('USD');
    expect(Number(actual!.montoOrigen)).toBeCloseTo(-10, 2);
    expect(actual!.cuotas).toBe('3/6');
    expect(actual!.cuenta).toBe('4517');
    expect(actual!.titular).toBe('JUAN PEREZ');
  });

  it('corregir el importe recalcula el matching', async () => {
    const l = await linea({ descriptor: 'CONSUMO ILEGIBLE', monto: -9999, fecha: new Date('2031-05-10T00:00:00Z') });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');

    await editarLinea(ctx, { lineaId: l.id, descriptor: 'CONSUMO ILEGIBLE', fecha: new Date('2031-05-10T00:00:00Z'), monto: -5000, moneda: 'ARS' });

    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.estado).toBe('SUGERIDA');
    expect((actual!.candidatos as { movimientoId: string }[])[0].movimientoId).toBe(movExistente);
  });

  it('audita la corrección con el valor anterior', async () => {
    const l = await linea({ descriptor: 'V1SA COMPRA', monto: -700 });
    await editarLinea(ctx, { lineaId: l.id, descriptor: 'VISA COMPRA', fecha: l.fecha, monto: -800, moneda: 'ARS' });
    const evento = await prisma.auditLog.findFirst({
      where: { empresaId, entidad: 'Resumen', entidadId: resumenId, accion: 'RESUMEN_EDITAR_LINEA' },
      orderBy: { createdAt: 'desc' },
    });
    expect(evento).not.toBeNull();
    const antes = evento!.antes as Record<string, unknown>;
    const despues = evento!.despues as Record<string, unknown>;
    expect(antes.descriptor).toBe('V1SA COMPRA');
    expect(Number(antes.monto)).toBeCloseTo(-700, 2);
    expect(despues.descriptor).toBe('VISA COMPRA');
    expect(Number(despues.monto)).toBeCloseTo(-800, 2);
  });

  it('rechaza el descriptor vacío', async () => {
    const l = await linea();
    await expect(editarLinea(ctx, { lineaId: l.id, descriptor: '   ', fecha: l.fecha, monto: -1000, moneda: 'ARS' })).rejects.toThrow(DomainError);
  });

  it('no edita una línea ya resuelta', async () => {
    const l = await linea({ monto: -5000 });
    await conciliarLinea(ctx, { lineaId: l.id, movimientoId: movExistente });
    await expect(editarLinea(ctx, { lineaId: l.id, descriptor: 'OTRO', fecha: l.fecha, monto: -1, moneda: 'ARS' })).rejects.toThrow(DomainError);
    const actual = await prisma.resumenLinea.findUnique({ where: { id: l.id } });
    expect(actual!.descriptor).toBe('LINEA TEST');
  });
});
