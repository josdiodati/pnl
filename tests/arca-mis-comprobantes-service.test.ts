import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { scopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { ErrorLoginArca, ErrorPortalArca } from '@/lib/arca/portal/cliente';
import {
  guardarCredencialArca,
  probarCredencialArca,
  importarMisComprobantes,
  cruzarComprobantesArca,
  cruzarMovimientoConArca,
  reconciliarTagArca,
  sincronizarMisComprobantes,
  encolarSyncsPendientes,
  ventanaSyncDiaria,
  type DepsArca,
} from '@/lib/arca/mis-comprobantes/service';
import { descifrarSecreto } from '@/lib/arca/mis-comprobantes/cifrado';
import type { FilaMisComprobantes } from '@/lib/arca/mis-comprobantes/tipos';

// Servicio de "Mis Comprobantes": credencial cifrada por empresa, prueba de
// ingreso con UN intento (si falla queda BLOQUEADA y avisa), importación del
// CSV, cruce contra el libro (marca VALIDO) y corrida de sync.

const SECRET = Buffer.alloc(32, 3).toString('hex');
const CUIT_EMPRESA = '30712093486';

const CAB_RECIBIDOS =
  '"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"';
const fila = (fecha: string, tipo: number, pv: number, nro: number, cae: string, cuit: string, nombre: string, total: string) =>
  `${fecha};${tipo};${pv};${nro};${nro};${cae};80;${cuit};${nombre};80;${CUIT_EMPRESA};1,00;$;;;;;;;;100,00;1000,00;;;1000,00;0,00;0,00;0,00;100,00;${total}`;

function filaNormalizada(p: Partial<FilaMisComprobantes> & Pick<FilaMisComprobantes, 'fechaEmision' | 'tipoComprobante' | 'puntoVenta' | 'numeroDesde' | 'nroDocContraparte'>): FilaMisComprobantes {
  return {
    numeroHasta: p.numeroDesde,
    codigoAutorizacion: null,
    tipoDocContraparte: 80,
    denominacionContraparte: null,
    nroDocReceptor: CUIT_EMPRESA,
    tipoCambio: 1,
    moneda: '$',
    ivaPorAlicuota: {},
    netoGravadoTotal: 1000,
    netoNoGravado: 0,
    exentas: 0,
    otrosTributos: 0,
    totalIva: 210,
    importeTotal: 1210,
    ...p,
  };
}

describe('Mis Comprobantes: servicio (integración)', () => {
  const sufijo = `mcmp-${Date.now()}`;
  let ctx: EmpresaContext;
  let empresaId: string;
  let usuarioId: string;
  let periodoId: string;

  beforeAll(async () => {
    process.env.ARCA_PORTAL_SECRET = SECRET;
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test MCMP', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Ewwo Test S.R.L.', cuit: CUIT_EMPRESA } });
    empresaId = empresa.id;
    periodoId = (await prisma.periodo.create({ data: { empresaId, anio: 2026, mes: 8 } })).id;
    ctx = { empresa, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre }, rol: 'ADMINISTRADOR', db: scopedDb(empresaId) } as EmpresaContext;
  });

  afterAll(async () => {
    await prisma.comprobanteArca.deleteMany({ where: { empresaId } });
    await prisma.credencialArca.deleteMany({ where: { empresaId } });
    await prisma.job.deleteMany({ where: { empresaId } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  beforeEach(async () => {
    await prisma.comprobanteArca.deleteMany({ where: { empresaId } });
    await prisma.credencialArca.deleteMany({ where: { empresaId } });
    await prisma.job.deleteMany({ where: { empresaId } });
    await prisma.movimiento.deleteMany({ where: { empresaId } });
  });

  const movimiento = (datos: Record<string, unknown>) =>
    prisma.movimiento.create({
      data: { empresaId, origen: 'COMPROBANTE', estado: 'VALIDADO', creadoPorId: usuarioId, periodoId, fechaDevengamiento: new Date('2026-08-05T00:00:00Z'), moneda: 'ARS', total: 1210, ...(datos as object) } as never,
    });

  // ---------- credencial ----------

  it('guarda la clave cifrada (no en claro) y la deja SIN_PROBAR; la auditoría no lleva la clave', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20-31419408-0', clave: 'ClaveSuperSecreta' });
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.cuitUsuario).toBe('20314194080');
    expect(c.claveCifrada).not.toContain('ClaveSuperSecreta');
    expect(descifrarSecreto(c.claveCifrada, SECRET)).toBe('ClaveSuperSecreta');
    expect(c.estado).toBe('SIN_PROBAR');
    const audit = await prisma.auditLog.findMany({ where: { empresaId, accion: 'ARCA_CREDENCIAL_GUARDAR' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].despues)).not.toContain('ClaveSuperSecreta');
  });

  it('rechaza un CUIT de usuario inválido o una clave vacía', async () => {
    await expect(guardarCredencialArca(ctx, { cuitUsuario: '123', clave: 'x' })).rejects.toThrow(DomainError);
    await expect(guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: '  ' })).rejects.toThrow(DomainError);
  });

  it('volver a guardar la clave destraba una credencial BLOQUEADA', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'vieja' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'BLOQUEADA', motivoBloqueo: 'x' } });
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'nueva' });
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('SIN_PROBAR');
    expect(c.motivoBloqueo).toBeNull();
  });

  it('probar: un intento exitoso deja OK y registra la fecha', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'ok' });
    let intentos = 0;
    const deps: DepsArca = { probarAcceso: async () => { intentos++; } };
    const r = await probarCredencialArca(ctx, deps);
    expect(r.ok).toBe(true);
    expect(intentos).toBe(1);
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('OK');
    expect(c.ultimoOkAt).not.toBeNull();
  });

  it('probar: si ARCA rechaza las credenciales queda BLOQUEADA con el motivo, sin reintentar', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'mala' });
    let intentos = 0;
    const deps: DepsArca = { probarAcceso: async () => { intentos++; throw new ErrorLoginArca('credenciales', 'ARCA rechazó el usuario o la Clave Fiscal.'); } };
    const r = await probarCredencialArca(ctx, deps);
    expect(r.ok).toBe(false);
    expect(intentos).toBe(1);
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('BLOQUEADA');
    expect(c.motivoBloqueo).toMatch(/rechazó/);
    expect(await prisma.auditLog.count({ where: { empresaId, accion: 'ARCA_CREDENCIAL_BLOQUEAR' } })).toBe(1);
  });

  it('probar: un fallo que no es de credenciales (portal caído) NO bloquea', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'ok' });
    const deps: DepsArca = { probarAcceso: async () => { throw new ErrorPortalArca('El WAF de ARCA bloqueó la consulta repetidas veces.'); } };
    const r = await probarCredencialArca(ctx, deps);
    expect(r.ok).toBe(false);
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('SIN_PROBAR');
    expect(c.ultimoErrorSync).toMatch(/WAF/);
  });

  // ---------- importación CSV ----------

  it('importa un CSV de recibidos, es idempotente y cruza con el libro marcando VALIDO', async () => {
    const mov = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '01007', numero: '00004312246', cae: '86294874222078', arcaEstado: 'NO_VERIFICADO' });
    const csv = `${CAB_RECIBIDOS}\n${fila('2026-08-01', 1, 1007, 4312246, '86294874222078', '30656631615', 'ALARMAS', '1210,00')}\n${fila('2026-08-02', 6, 5, 12, '86294874222079', '20111111112', 'OTRO', '500,00')}\n`;
    const r1 = await importarMisComprobantes(ctx, { contenido: Buffer.from(csv), nombreArchivo: 'comprobantes_consulta_csv_recibidos_1_30712093486_20260916-1112.csv' });
    expect(r1).toMatchObject({ origen: 'RECIBIDO', nuevos: 2, actualizados: 0, cruzados: 1 });
    const r2 = await importarMisComprobantes(ctx, { contenido: Buffer.from(csv), nombreArchivo: 'x.csv' });
    expect(r2).toMatchObject({ nuevos: 0, actualizados: 2, cruzados: 0 });
    expect(await prisma.comprobanteArca.count({ where: { empresaId } })).toBe(2);
    const cruzado = await prisma.comprobanteArca.findFirstOrThrow({ where: { empresaId, numeroDesde: 4312246 } });
    expect(cruzado.movimientoId).toBe(mov.id);
    const actual = await prisma.movimiento.findUniqueOrThrow({ where: { id: mov.id } });
    expect(actual.arcaEstado).toBe('VALIDO');
    expect(actual.arcaDetalle).toMatch(/Mis Comprobantes/);
    expect(await prisma.auditLog.count({ where: { empresaId, entidad: 'Movimiento', entidadId: mov.id, accion: 'ARCA_CONSTATAR' } })).toBe(1);
  });

  it('rechaza un CSV de recibidos cuyo receptor no es la empresa', async () => {
    const csv = `${CAB_RECIBIDOS}\n${fila('2026-08-01', 1, 1, 1, '1', '30656631615', 'X', '1,00').replace(`80;${CUIT_EMPRESA};`, '80;30718332148;')}\n`;
    await expect(importarMisComprobantes(ctx, { contenido: Buffer.from(csv), nombreArchivo: 'r.csv' })).rejects.toThrow(/otra empresa|30-71833214-8/);
  });

  it('rechaza un archivo cuyo nombre trae el CUIT de otra empresa', async () => {
    const csv = `${CAB_RECIBIDOS}\n${fila('2026-08-01', 1, 1, 1, '1', '30656631615', 'X', '1,00')}\n`;
    await expect(importarMisComprobantes(ctx, { contenido: Buffer.from(csv), nombreArchivo: 'comprobantes_consulta_csv_recibidos_1_30718332148_20260916-1112.csv' })).rejects.toThrow(/30-71833214-8/);
  });

  it('rechaza lo que no es CSV ni ZIP de Mis Comprobantes', async () => {
    await expect(importarMisComprobantes(ctx, { contenido: Buffer.from('a;b\n1;2'), nombreArchivo: 'x.csv' })).rejects.toThrow(DomainError);
  });

  // ---------- cruce ----------

  it('cruza por CAE aunque el tipo no esté mapeado, y por clave aunque el CAE falte; nunca contra anulados', async () => {
    const porCae = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'OTRO', puntoVenta: null, numero: null, cae: '99999999999999' });
    const porClave = await movimiento({ cuitEmisor: '20111111112', tipoComprobante: 'FACTURA_C', puntoVenta: '3', numero: '77', cae: null });
    await movimiento({ cuitEmisor: '20222222223', tipoComprobante: 'FACTURA_A', puntoVenta: '1', numero: '5', cae: null, estado: 'ANULADO' });
    await prisma.comprobanteArca.createMany({
      data: [
        { empresaId, origen: 'RECIBIDO', fechaEmision: new Date('2026-08-01T00:00:00Z'), tipoComprobante: 201, puntoVenta: 9, numeroDesde: 9, numeroHasta: 9, codigoAutorizacion: '99999999999999', nroDocContraparte: '30656631615', fuente: 'CSV', sincronizadoAt: new Date() },
        { empresaId, origen: 'RECIBIDO', fechaEmision: new Date('2026-08-01T00:00:00Z'), tipoComprobante: 11, puntoVenta: 3, numeroDesde: 77, numeroHasta: 77, codigoAutorizacion: '1', nroDocContraparte: '20111111112', fuente: 'CSV', sincronizadoAt: new Date() },
        { empresaId, origen: 'RECIBIDO', fechaEmision: new Date('2026-08-01T00:00:00Z'), tipoComprobante: 1, puntoVenta: 1, numeroDesde: 5, numeroHasta: 5, codigoAutorizacion: '2', nroDocContraparte: '20222222223', fuente: 'CSV', sincronizadoAt: new Date() },
      ],
    });
    const r = await cruzarComprobantesArca(ctx.db, ctx.empresa, usuarioId);
    expect(r.cruzados).toBe(2);
    const arca = await prisma.comprobanteArca.findMany({ where: { empresaId }, orderBy: { numeroDesde: 'asc' } });
    expect(arca.find((a) => a.numeroDesde === 9)!.movimientoId).toBe(porCae.id);
    expect(arca.find((a) => a.numeroDesde === 77)!.movimientoId).toBe(porClave.id);
    expect(arca.find((a) => a.numeroDesde === 5)!.movimientoId).toBeNull();
  });

  it('emitidos cruzan contra las ventas del libro (CUIT emisor = la empresa)', async () => {
    const venta = await movimiento({ origen: 'VENTA_COMPROBANTE', cuitEmisor: CUIT_EMPRESA, tipoComprobante: 'FACTURA_A', puntoVenta: '2', numero: '686', cae: '86338977428571' });
    await prisma.comprobanteArca.create({
      data: { empresaId, origen: 'EMITIDO', fechaEmision: new Date('2026-08-19T00:00:00Z'), tipoComprobante: 1, puntoVenta: 2, numeroDesde: 686, numeroHasta: 686, codigoAutorizacion: '86338977428571', nroDocContraparte: '30718332148', fuente: 'CSV', sincronizadoAt: new Date() },
    });
    const r = await cruzarComprobantesArca(ctx.db, ctx.empresa, usuarioId);
    expect(r.cruzados).toBe(1);
    expect((await prisma.comprobanteArca.findFirstOrThrow({ where: { empresaId } })).movimientoId).toBe(venta.id);
  });

  // ---------- el cruce es la ÚNICA fuente del tag ARCA ----------

  const arcaRecibido = (over: Record<string, unknown>) =>
    prisma.comprobanteArca.create({
      data: { empresaId, origen: 'RECIBIDO', fechaEmision: new Date('2026-08-01T00:00:00Z'), tipoComprobante: 1, puntoVenta: 1, numeroDesde: 9, numeroHasta: 9, codigoAutorizacion: '86294874222078', nroDocContraparte: '30656631615', fuente: 'CSV', sincronizadoAt: new Date(), ...(over as object) } as never,
    });

  it('cruzarMovimientoConArca: un comprobante recién ingresado cruza contra lo ya bajado, sin esperar la próxima sync', async () => {
    const c = await arcaRecibido({});
    const mov = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '1', numero: '9', cae: '86294874222078', arcaEstado: 'NO_VERIFICADO' });
    const r = await cruzarMovimientoConArca(ctx.db, ctx.empresa, mov.id, usuarioId);
    expect(r.cruzado).toBe(true);
    expect((await prisma.comprobanteArca.findUniqueOrThrow({ where: { id: c.id } })).movimientoId).toBe(mov.id);
    const actual = await prisma.movimiento.findUniqueOrThrow({ where: { id: mov.id } });
    expect(actual.arcaEstado).toBe('VALIDO');
    expect(actual.arcaDetalle).toContain('Mis Comprobantes');
  });

  it('cruzarMovimientoConArca: sin comprobante de ARCA que coincida, no toca el tag', async () => {
    await arcaRecibido({ numeroDesde: 500, numeroHasta: 500, codigoAutorizacion: '11111111111111' });
    const mov = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '1', numero: '9', cae: '86294874222078', arcaEstado: 'NO_VERIFICADO' });
    const r = await cruzarMovimientoConArca(ctx.db, ctx.empresa, mov.id, usuarioId);
    expect(r.cruzado).toBe(false);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: mov.id } })).arcaEstado).toBe('NO_VERIFICADO');
  });

  it('el cruce confirma un duplicado detectado en la extracción: el pendiente con flag pasa a DUPLICADO', async () => {
    const original = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '1', numero: '9', cae: '86294874222078', arcaEstado: 'VALIDO' });
    const repetido = await movimiento({ estado: 'PENDIENTE_VALIDACION', cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '1', numero: '9', cae: '86294874222078', arcaEstado: 'NO_VERIFICADO', flags: { duplicados: [original.id] } });
    await arcaRecibido({});
    await cruzarMovimientoConArca(ctx.db, ctx.empresa, repetido.id, usuarioId);
    const actual = await prisma.movimiento.findUniqueOrThrow({ where: { id: repetido.id } });
    expect(actual.arcaEstado).toBe('VALIDO');
    expect(actual.estado).toBe('DUPLICADO');
  });

  it('reconciliarTagArca: VALIDO si y sólo si cruza con Mis Comprobantes; lo demás vuelve a NO_VERIFICADO', async () => {
    // Herencia del simulador viejo: "válido" sin respaldo, e "inválido" con respaldo.
    const sinRespaldo = await movimiento({ cae: '86000000000001', arcaEstado: 'VALIDO', arcaDetalle: 'Comprobante autorizado (mock)' });
    const conRespaldo = await movimiento({ cae: '86373175667100', arcaEstado: 'INVALIDO', arcaDetalle: 'mock: CAE termina en 00', estado: 'OBSERVADO' });
    const yaBien = await movimiento({ cae: '86294874222078', arcaEstado: 'VALIDO', arcaDetalle: 'Comprobante autorizado (mock)' });
    const errorConsulta = await movimiento({ cae: null, arcaEstado: 'ERROR_CONSULTA' });
    await arcaRecibido({ codigoAutorizacion: '86373175667100', movimientoId: conRespaldo.id });
    await arcaRecibido({ numeroDesde: 10, numeroHasta: 10, codigoAutorizacion: '86294874222078', movimientoId: yaBien.id });

    const r = await reconciliarTagArca(ctx.db, usuarioId);
    expect(r.corregidos).toBe(4);
    const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id } });
    expect((await leer(sinRespaldo.id)).arcaEstado).toBe('NO_VERIFICADO');
    const arreglado = await leer(conRespaldo.id);
    expect(arreglado.arcaEstado).toBe('VALIDO');
    expect(arreglado.arcaDetalle).toContain('Mis Comprobantes');
    expect(arreglado.estado).toBe('OBSERVADO'); // el estado del libro no se toca: lo resuelve una persona
    expect((await leer(yaBien.id)).arcaDetalle).toContain('Mis Comprobantes'); // el detalle "mock" se reescribe
    expect((await leer(errorConsulta.id)).arcaEstado).toBe('NO_VERIFICADO');

    // Idempotente: una segunda corrida no cambia nada.
    expect((await reconciliarTagArca(ctx.db, usuarioId)).corregidos).toBe(0);
  });

  it('cruzarComprobantesArca reconcilia al final: un "válido" sin respaldo cae en la misma corrida', async () => {
    const fantasma = await movimiento({ cae: '86000000000002', arcaEstado: 'VALIDO', arcaDetalle: 'Comprobante autorizado (mock)' });
    await cruzarComprobantesArca(ctx.db, ctx.empresa, usuarioId);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: fantasma.id } })).arcaEstado).toBe('NO_VERIFICADO');
  });

  // ---------- sync ----------

  it('ventanaSyncDiaria: termina ayer (hora Argentina) y abarca 30 días', () => {
    const v = ventanaSyncDiaria(new Date('2026-09-16T02:30:00Z')); // 15-sep 23:30 en Buenos Aires
    expect(v.hasta.toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(v.desde.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('sincronizar: baja emitidos y recibidos, guarda, cruza y registra la corrida', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'ok' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'OK' } });
    const mov = await movimiento({ cuitEmisor: '30656631615', tipoComprobante: 'FACTURA_A', puntoVenta: '1007', numero: '4312246', cae: null });
    const deps: DepsArca = {
      descargar: async (p) => {
        expect(p.cuitUsuario).toBe('20314194080');
        expect(p.clave).toBe('ok');
        expect(p.cuitEmpresa).toBe(CUIT_EMPRESA);
        return {
          emitidos: [filaNormalizada({ fechaEmision: '2026-08-19', tipoComprobante: 1, puntoVenta: 2, numeroDesde: 686, nroDocContraparte: '30718332148', nroDocReceptor: null })],
          recibidos: [filaNormalizada({ fechaEmision: '2026-08-01', tipoComprobante: 1, puntoVenta: 1007, numeroDesde: 4312246, nroDocContraparte: '30656631615', codigoAutorizacion: '86294874222078' })],
          csvEmitidos: '',
          csvRecibidos: '',
        };
      },
    };
    const r = await sincronizarMisComprobantes(empresaId, {}, deps);
    expect(r).toMatchObject({ estado: 'OK', emitidos: 1, recibidos: 1, cruzados: 1 });
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.ultimaSyncAt).not.toBeNull();
    expect(c.erroresSeguidos).toBe(0);
    expect((await prisma.movimiento.findUniqueOrThrow({ where: { id: mov.id } })).arcaEstado).toBe('VALIDO');
    expect(await prisma.comprobanteArca.count({ where: { empresaId, fuente: 'PORTAL' } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { empresaId, accion: 'ARCA_SYNC' } })).toBe(1);
  });

  it('sincronizar: login rechazado → BLOQUEADA, no lanza (el job no debe reintentar)', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'mala' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'OK' } });
    const deps: DepsArca = { descargar: async () => { throw new ErrorLoginArca('cambio_clave', 'ARCA exige cambiar la Clave Fiscal antes de seguir.'); } };
    const r = await sincronizarMisComprobantes(empresaId, {}, deps);
    expect(r.estado).toBe('BLOQUEADA');
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('BLOQUEADA');
    expect(c.motivoBloqueo).toMatch(/cambiar la Clave Fiscal/);
  });

  it('sincronizar: con la credencial BLOQUEADA no intenta nada', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'x' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'BLOQUEADA', motivoBloqueo: 'm' } });
    let llamadas = 0;
    const r = await sincronizarMisComprobantes(empresaId, {}, { descargar: async () => { llamadas++; throw new Error('no'); } });
    expect(r.estado).toBe('BLOQUEADA');
    expect(llamadas).toBe(0);
  });

  it('sincronizar: un error del portal cuenta como error seguido, no bloquea y se propaga para reintentar', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'ok' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'OK' } });
    const deps: DepsArca = { descargar: async () => { throw new ErrorPortalArca('Respuesta inesperada de Mis Comprobantes'); } };
    await expect(sincronizarMisComprobantes(empresaId, {}, deps)).rejects.toBeInstanceOf(ErrorPortalArca);
    const c = await prisma.credencialArca.findUniqueOrThrow({ where: { empresaId } });
    expect(c.estado).toBe('OK');
    expect(c.erroresSeguidos).toBe(1);
    expect(c.ultimoErrorSync).toMatch(/inesperada/);
  });

  it('encolarSyncsPendientes: a partir de las 06:30 encola una vez por día por empresa con credencial OK y sync automático', async () => {
    await guardarCredencialArca(ctx, { cuitUsuario: '20314194080', clave: 'ok' });
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'OK' } });
    const temprano = new Date('2026-09-16T08:00:00Z'); // 05:00 en Buenos Aires
    expect(await encolarSyncsPendientes(temprano)).toBe(0);
    const aHorario = new Date('2026-09-16T09:45:00Z'); // 06:45
    expect(await encolarSyncsPendientes(aHorario)).toBe(1);
    expect(await encolarSyncsPendientes(new Date('2026-09-16T15:00:00Z'))).toBe(0); // ya encolado hoy
    const job = await prisma.job.findFirstOrThrow({ where: { empresaId, tipo: 'SYNC_MIS_COMPROBANTES' } });
    expect(job.maxIntentos).toBe(2);
    await prisma.credencialArca.update({ where: { empresaId }, data: { estado: 'BLOQUEADA' } });
    await prisma.job.deleteMany({ where: { empresaId } });
    expect(await encolarSyncsPendientes(aHorario)).toBe(0);
  });
});
