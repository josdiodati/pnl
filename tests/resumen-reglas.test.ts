import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import { reglaResumenMatchea, aplicarReglasResumen, crearReglaDesdeLinea } from '@/lib/resumenes/reglas';
import { deshacerLinea } from '@/lib/resumenes/service';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';

// Reglas de auto-resolución de líneas de resumen: IGNORAR aplica a cualquier
// línea no resuelta; IMPUTAR sólo a líneas sin sugerencia y con importe en
// pesos (la sugerencia de conciliación gana: anti-duplicados).

describe('reglaResumenMatchea (puro)', () => {
  const resumen = { emisor: 'VISA Santander', tipo: 'TARJETA' };
  const base = { emisor: null, tipo: null } as { emisor: string | null; tipo: 'TARJETA' | 'BANCO' | null };

  it('matchea por contenido del descriptor, normalizado (mayúsculas y acentos)', () => {
    const regla = { ...base, descriptorContiene: 'su pago en pesos' };
    expect(reglaResumenMatchea(regla as never, { descriptor: 'SU PAGO EN PESOS 1234' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'Sú Págo en Pesos' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'ANTHROPIC CLAUD' }, resumen)).toBe(false);
  });

  it('"Pago de servicios Imp.afip" matchea los débitos de ARCA del Santander, con o sin número al frente', () => {
    // Regla real de Ewwo (motivo "Pagos ARCA"): el punto de "Imp.afip" se
    // normaliza a espacio en los dos lados, y el banco a veces antepone un número.
    const regla = { ...base, descriptorContiene: 'Pago de servicios Imp.afip' };
    const banco = { emisor: 'Santander CC $', tipo: 'BANCO' };
    expect(reglaResumenMatchea(regla as never, { descriptor: 'Pago de servicios Imp.afip: 3071209348631419408 - tarj nro. 2856' }, banco)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: '61767994 Pago de servicios Imp.afip: 3071209348631419408 - tarj nro. 2856' }, banco)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'Debito automatico Afip -30712093486' }, banco)).toBe(false);
  });

  it('condición vacía no matchea nunca (evita atrapa-todo)', () => {
    expect(reglaResumenMatchea({ ...base, descriptorContiene: '  ' } as never, { descriptor: 'CUALQUIERA' }, resumen)).toBe(false);
  });

  it('una sola condición cubre el separador de miles: "ley 25.413" y "LEY 25413"', () => {
    // El impuesto al cheque aparece en los dos formatos en el mismo banco.
    const regla = { ...base, descriptorContiene: 'ley 25413' };
    expect(reglaResumenMatchea(regla as never, { descriptor: 'Impuesto ley 25.413 credito 0,6%' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'IMP.LEY 25413 13/07/26 00002' }, resumen)).toBe(true);
  });

  it('matchea palabras completas: "iva" no matchea "privada"', () => {
    const regla = { ...base, descriptorContiene: 'iva' };
    expect(reglaResumenMatchea(regla as never, { descriptor: 'DB IVA $ RESP INSC. 21%' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'PERCEP.IVA RG2408 3,0%' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'COMPRA PRIVADA 123' }, resumen)).toBe(false);
  });

  it('las condiciones ya cargadas en producción siguen matcheando', () => {
    const sircreb = { ...base, descriptorContiene: 'sircreb' };
    expect(
      reglaResumenMatchea(sircreb as never, { descriptor: 'Regimen de recaudacion sircreb u Resp:30712093486 / 2,50% sobre $16.593.284,18' }, resumen),
    ).toBe(true);
    const nabu = { ...base, descriptorContiene: 'NABU CASA - HA C USD 6,50' };
    expect(reglaResumenMatchea(nabu as never, { descriptor: 'NABU CASA - HA C USD 6,50' }, resumen)).toBe(true);
  });

  it('emisor y tipo acotan la regla', () => {
    const regla = { descriptorContiene: 'pago', emisor: 'visa santander', tipo: 'TARJETA' };
    expect(reglaResumenMatchea(regla as never, { descriptor: 'SU PAGO' }, resumen)).toBe(true);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'SU PAGO' }, { emisor: 'BBVA', tipo: 'TARJETA' })).toBe(false);
    expect(reglaResumenMatchea(regla as never, { descriptor: 'SU PAGO' }, { emisor: 'VISA Santander', tipo: 'BANCO' })).toBe(false);
  });
});

describe('aplicación de reglas de resumen (integración)', () => {
  const sufijo = `regres-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let usuarioId: string;
  let resumenId: string;
  let categoriaId: string;
  let centroId: string;
  const linea = async (datos: Record<string, unknown> = {}) =>
    prisma.resumenLinea.create({
      data: { resumenId, orden: 99, descriptor: 'LINEA', monto: -1000, moneda: 'ARS', fecha: new Date('2032-03-10T00:00:00Z'), ...datos } as never,
    });

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Reglas', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'RegRes SA', cuit: '30714325651' } });
    empresaId = empresa.id;
    const periodo = await prisma.periodo.create({ data: { empresaId, anio: 2032, mes: 3 } });
    categoriaId = (await prisma.categoria.create({ data: { empresaId, nombre: 'Impuestos Test', tipo: 'EGRESO' } })).id;
    centroId = (await prisma.centroCosto.create({ data: { empresaId, nombre: 'Admin Test', tipo: 'SOPORTE' } })).id;
    resumenId = (await prisma.resumen.create({
      data: { empresaId, tipo: 'TARJETA', emisor: 'VISA Test', periodoId: periodo.id, estado: 'EXTRAIDO', archivoKey: 'k', archivoNombre: 'r.pdf', archivoMime: 'application/pdf', archivoHash: `h-${sufijo}` },
    })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'VALIDADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.reglaResumen.deleteMany({ where: { empresaId } });
    await prisma.movimientoLinea.deleteMany({ where: { movimiento: { empresaId } } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.categoria.deleteMany({ where: { empresaId } });
    await prisma.centroCosto.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.deleteMany({ where: { email: `${sufijo}@test.local` } });
  });

  it('IGNORAR resuelve pendientes y sugeridas; deshacer limpia el marcador de regla', async () => {
    await prisma.reglaResumen.create({
      data: { empresaId, nombre: 'Pago resumen', descriptorContiene: 'SU PAGO', accion: 'IGNORAR', motivoIgnorar: 'Pago del resumen' } as never,
    });
    const lPend = await linea({ descriptor: 'SU PAGO EN PESOS' });
    const lSug = await linea({ descriptor: 'SU PAGO EN DOLARES', estado: 'SUGERIDA', candidatos: [] });
    const lOtra = await linea({ descriptor: 'ANTHROPIC CLAUD' });

    const r = await aplicarReglasResumen(ctx.db, resumenId, usuarioId);
    expect(r.ignoradas).toBe(2);
    expect(r.imputadas).toBe(0);

    const pend = await prisma.resumenLinea.findUnique({ where: { id: lPend.id } });
    expect(pend!.estado).toBe('IGNORADA');
    expect(pend!.motivoIgnorada).toBe('Pago del resumen');
    expect(pend!.reglaAplicada).toBe('Pago resumen');
    expect((await prisma.resumenLinea.findUnique({ where: { id: lSug.id } }))!.estado).toBe('IGNORADA');
    expect((await prisma.resumenLinea.findUnique({ where: { id: lOtra.id } }))!.estado).toBe('PENDIENTE');

    await deshacerLinea(ctx, { lineaId: lPend.id });
    const deshecha = await prisma.resumenLinea.findUnique({ where: { id: lPend.id } });
    expect(deshecha!.estado).toBe('PENDIENTE');
    expect(deshecha!.reglaAplicada).toBeNull();
  });

  it('IMPUTAR crea el movimiento para pendientes, pero respeta sugerencias y líneas sin pesos', async () => {
    await prisma.reglaResumen.create({
      data: { empresaId, nombre: 'Sircreb', descriptorContiene: 'SIRCREB', accion: 'IMPUTAR', categoriaId, centroCostoId: centroId } as never,
    });
    const lPend = await linea({ descriptor: 'SIRCREB RETENCION', monto: -2500 });
    const lSug = await linea({ descriptor: 'SIRCREB OTRA', estado: 'SUGERIDA', candidatos: [] });
    const lUsd = await linea({ descriptor: 'SIRCREB USD', monto: null, moneda: 'USD', montoOrigen: -10 });

    const r = await aplicarReglasResumen(ctx.db, resumenId, usuarioId);
    expect(r.imputadas).toBe(1);

    const imputadaLinea = await prisma.resumenLinea.findUnique({ where: { id: lPend.id }, include: { vinculos: { include: { movimiento: { include: { lineas: true } } } } } });
    const imputada = { ...imputadaLinea!, movimiento: imputadaLinea!.vinculos[0]?.movimiento ?? null };
    expect(imputada!.estado).toBe('IMPUTADA');
    expect(imputada!.reglaAplicada).toBe('Sircreb');
    expect(imputada!.movimiento!.origen).toBe('RESUMEN');
    expect(imputada!.movimiento!.estado).toBe('ASIGNADO');
    expect(Number(imputada!.movimiento!.total)).toBe(2500);
    expect(imputada!.movimiento!.creadoPorId).toBe(usuarioId);
    expect(imputada!.movimiento!.lineas).toHaveLength(1);
    expect(imputada!.movimiento!.lineas[0].centroCostoId).toBe(centroId);

    expect((await prisma.resumenLinea.findUnique({ where: { id: lSug.id } }))!.estado).toBe('SUGERIDA');
    expect((await prisma.resumenLinea.findUnique({ where: { id: lUsd.id } }))!.estado).toBe('PENDIENTE');
  });

  it('sin usuario no aplica nada (no hay autor para el movimiento/auditoría)', async () => {
    const l = await linea({ descriptor: 'SU PAGO SIN USUARIO' });
    const r = await aplicarReglasResumen(ctx.db, resumenId, null);
    expect(r).toEqual({ ignoradas: 0, imputadas: 0 });
    expect((await prisma.resumenLinea.findUnique({ where: { id: l.id } }))!.estado).toBe('PENDIENTE');
  });

  it('crearReglaDesdeLinea crea con el descriptor como condición y no duplica', async () => {
    const l = await linea({ descriptor: 'COMISION MANTENIMIENTO' });
    const r1 = await crearReglaDesdeLinea(ctx.db, { lineaId: l.id, accion: 'IGNORAR', motivo: 'comisión' });
    expect(r1.creada).toBe(true);
    const regla = await prisma.reglaResumen.findFirst({ where: { empresaId, nombre: r1.nombre } });
    expect(regla!.descriptorContiene).toBe('COMISION MANTENIMIENTO');
    expect(regla!.accion).toBe('IGNORAR');
    expect(regla!.motivoIgnorar).toBe('comisión');

    const r2 = await crearReglaDesdeLinea(ctx.db, { lineaId: l.id, accion: 'IGNORAR', motivo: 'otra vez' });
    expect(r2.creada).toBe(false);
    expect(await prisma.reglaResumen.count({ where: { empresaId, nombre: r1.nombre } })).toBe(1);
  });
});
