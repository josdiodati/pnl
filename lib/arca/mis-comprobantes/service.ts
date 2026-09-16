import type { Empresa } from '@prisma/client';
import { prisma } from '@/lib/db';
import { scopedDb, type ScopedDb } from '@/lib/empresa/scope';
import type { EmpresaContext } from '@/lib/empresa/require-empresa';
import { DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { cuitEsValido, formatearCuit, normalizarCuit } from '@/lib/checks/cuit';
import { CODIGO_ARCA } from '@/lib/arca';
import { cifrarSecreto, descifrarSecreto } from './cifrado';
import { parsearCsvMisComprobantes } from './csv';
import { extraerCsvDeZip } from './zip';
import type { FilaMisComprobantes, OrigenMisComprobantes } from './tipos';
import {
  ClientePortalArca,
  ErrorLoginArca,
  descargarMisComprobantes,
  type ParametrosDescarga,
  type ResultadoDescarga,
} from '@/lib/arca/portal/cliente';

// "Mis Comprobantes" de ARCA en PNL: la Clave Fiscal se guarda cifrada por
// empresa (Configuración, sólo administradores); el job diario baja emitidos
// y recibidos con UN login por corrida; el cruce contra el libro marca los
// comprobantes que figuran en ARCA como VALIDO. Política de la credencial:
// si el login falla por credenciales (o CAPTCHA, cambio de clave, segundo
// factor) queda BLOQUEADA con aviso y NO se vuelve a intentar hasta que un
// administrador la re-guarde o toque "Probar ingreso". Los fallos que no son
// de credenciales (portal caído, WAF) no bloquean: cuentan como error seguido.

export type DepsArca = {
  descargar?: (params: ParametrosDescarga) => Promise<ResultadoDescarga>;
  /** Un login + apertura de Mis Comprobantes para la empresa; lanza ErrorLoginArca si ARCA rechaza. */
  probarAcceso?: (params: { cuitUsuario: string; clave: string; cuitEmpresa: string }) => Promise<void>;
};

const depsReales: Required<DepsArca> = {
  descargar: (params) => descargarMisComprobantes(params),
  probarAcceso: async ({ cuitUsuario, clave, cuitEmpresa }) => {
    const cliente = new ClientePortalArca();
    try {
      await cliente.login(cuitUsuario, clave);
      await cliente.abrirMisComprobantes(cuitEmpresa);
    } finally {
      await cliente.salir();
    }
  },
};

const DIAS_VENTANA_SYNC = 30;
const HORA_SYNC_AR = { hora: 6, minuto: 30 };
const ZONA_AR = 'America/Argentina/Buenos_Aires';

// ---------- credencial ----------

export async function guardarCredencialArca(ctx: EmpresaContext, params: { cuitUsuario: string; clave: string }): Promise<void> {
  const cuitUsuario = normalizarCuit(params.cuitUsuario);
  if (!cuitEsValido(cuitUsuario)) throw new DomainError('El CUIT con el que se ingresa a ARCA no es válido.');
  const clave = params.clave;
  if (!clave.trim()) throw new DomainError('La Clave Fiscal no puede quedar vacía.');
  let claveCifrada: string;
  try {
    claveCifrada = cifrarSecreto(clave);
  } catch (e) {
    throw new DomainError(`No se puede guardar la clave: ${(e as Error).message}`);
  }
  const previa = await ctx.db.credencialArca.findFirst({ where: {} });
  const data = { cuitUsuario, claveCifrada, estado: 'SIN_PROBAR' as const, motivoBloqueo: null, ultimoErrorSync: null, erroresSeguidos: 0 };
  const guardada = previa
    ? await ctx.db.credencialArca.update({ where: { id: previa.id }, data })
    : await ctx.db.credencialArca.create({ data: { ...data, empresaId: ctx.empresa.id } as never });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'CredencialArca',
    entidadId: guardada.id,
    accion: 'ARCA_CREDENCIAL_GUARDAR',
    antes: previa ? { cuitUsuario: previa.cuitUsuario, estado: previa.estado } : undefined,
    despues: { cuitUsuario, estado: 'SIN_PROBAR' }, // nunca la clave
  });
}

export async function borrarCredencialArca(ctx: EmpresaContext): Promise<void> {
  const previa = await ctx.db.credencialArca.findFirst({ where: {} });
  if (!previa) return;
  await ctx.db.credencialArca.delete({ where: { id: previa.id } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'CredencialArca',
    entidadId: previa.id,
    accion: 'ARCA_CREDENCIAL_BORRAR',
    antes: { cuitUsuario: previa.cuitUsuario, estado: previa.estado },
  });
}

export async function cambiarSyncAutomatico(ctx: EmpresaContext, activo: boolean): Promise<void> {
  const previa = await ctx.db.credencialArca.findFirst({ where: {} });
  if (!previa) throw new DomainError('Primero guardá la Clave Fiscal.');
  await ctx.db.credencialArca.update({ where: { id: previa.id }, data: { syncAutomatico: activo } });
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'CredencialArca',
    entidadId: previa.id,
    accion: 'ARCA_SYNC_AUTOMATICO',
    antes: { syncAutomatico: previa.syncAutomatico },
    despues: { syncAutomatico: activo },
  });
}

async function bloquearCredencial(db: ScopedDb, credencialId: string, motivo: string, usuarioId: string | null): Promise<void> {
  await db.credencialArca.update({
    where: { id: credencialId },
    data: { estado: 'BLOQUEADA', motivoBloqueo: motivo, ultimoIntentoAt: new Date() },
  });
  await writeAudit(db, {
    usuarioId,
    entidad: 'CredencialArca',
    entidadId: credencialId,
    accion: 'ARCA_CREDENCIAL_BLOQUEAR',
    despues: { motivo },
  });
}

/**
 * "Probar ingreso": exactamente un intento de login con la clave guardada.
 * Éxito → OK (y el sync diario retoma). Rechazo de ARCA → BLOQUEADA con el
 * motivo. Otro fallo (portal caído) → no bloquea, queda anotado.
 */
export async function probarCredencialArca(ctx: EmpresaContext, deps: DepsArca = {}): Promise<{ ok: boolean; mensaje: string }> {
  const d = { ...depsReales, ...deps };
  const cred = await ctx.db.credencialArca.findFirst({ where: {} });
  if (!cred) throw new DomainError('Primero guardá la Clave Fiscal.');
  const clave = descifrarSecreto(cred.claveCifrada);
  await ctx.db.credencialArca.update({ where: { id: cred.id }, data: { ultimoIntentoAt: new Date() } });
  try {
    await d.probarAcceso({ cuitUsuario: cred.cuitUsuario, clave, cuitEmpresa: ctx.empresa.cuit });
  } catch (e) {
    if (e instanceof ErrorLoginArca) {
      await bloquearCredencial(ctx.db, cred.id, e.message, ctx.usuario.id);
      return { ok: false, mensaje: `${e.message} La credencial quedó bloqueada: verificá si cambió la Clave Fiscal y volvé a guardarla.` };
    }
    const mensaje = e instanceof Error ? e.message : String(e);
    await ctx.db.credencialArca.update({ where: { id: cred.id }, data: { ultimoErrorSync: mensaje } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'CredencialArca', entidadId: cred.id, accion: 'ARCA_CREDENCIAL_PROBAR', despues: { ok: false, error: mensaje } });
    return { ok: false, mensaje: `No se pudo completar la prueba (no es un problema de la clave): ${mensaje}` };
  }
  await ctx.db.credencialArca.update({
    where: { id: cred.id },
    data: { estado: 'OK', motivoBloqueo: null, ultimoOkAt: new Date(), ultimoErrorSync: null, erroresSeguidos: 0 },
  });
  await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'CredencialArca', entidadId: cred.id, accion: 'ARCA_CREDENCIAL_PROBAR', despues: { ok: true } });
  return { ok: true, mensaje: 'Ingreso a ARCA verificado: Mis Comprobantes abre para esta empresa. El sync diario queda habilitado.' };
}

// ---------- guardar filas ----------

function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export async function guardarFilasArca(
  db: ScopedDb,
  empresaId: string,
  origen: OrigenMisComprobantes,
  filas: FilaMisComprobantes[],
  fuente: 'CSV' | 'PORTAL',
): Promise<{ nuevos: number; actualizados: number }> {
  let nuevos = 0;
  let actualizados = 0;
  const ahora = new Date();
  for (const f of filas) {
    const clave = { empresaId, origen, nroDocContraparte: f.nroDocContraparte, tipoComprobante: f.tipoComprobante, puntoVenta: f.puntoVenta, numeroDesde: f.numeroDesde };
    const data = {
      fechaEmision: fechaUtc(f.fechaEmision),
      numeroHasta: f.numeroHasta,
      codigoAutorizacion: f.codigoAutorizacion,
      tipoDocContraparte: f.tipoDocContraparte,
      denominacionContraparte: f.denominacionContraparte,
      tipoCambio: f.tipoCambio,
      moneda: f.moneda,
      netoGravadoTotal: f.netoGravadoTotal,
      netoNoGravado: f.netoNoGravado,
      exentas: f.exentas,
      otrosTributos: f.otrosTributos,
      totalIva: f.totalIva,
      importeTotal: f.importeTotal,
      ivaPorAlicuota: f.ivaPorAlicuota as never,
      fuente,
      sincronizadoAt: ahora,
    };
    const existente = await db.comprobanteArca.findFirst({ where: clave, select: { id: true } });
    if (existente) {
      await db.comprobanteArca.update({ where: { id: existente.id }, data });
      actualizados++;
    } else {
      await db.comprobanteArca.create({ data: { ...clave, ...data } as never });
      nuevos++;
    }
  }
  return { nuevos, actualizados };
}

// ---------- cruce con el libro ----------

const TIPO_POR_CODIGO: Record<number, string> = Object.fromEntries(Object.entries(CODIGO_ARCA).map(([tipo, codigo]) => [codigo, tipo]));

function numero(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/\D/g, ''));
  return Number.isFinite(n) && String(s).trim() ? n : null;
}

/**
 * Cruza los comprobantes de ARCA sin cruzar contra el libro: por código de
 * autorización, o por CUIT emisor + tipo + punto de venta + número. Los que
 * cruzan marcan al movimiento como VALIDO ante ARCA (fuente: Mis
 * Comprobantes) en vez de la constatación por web service.
 */
export async function cruzarComprobantesArca(db: ScopedDb, empresa: Pick<Empresa, 'id' | 'cuit'>, usuarioId: string | null): Promise<{ cruzados: number }> {
  const pendientes = await db.comprobanteArca.findMany({ where: { movimientoId: null } });
  if (pendientes.length === 0) return { cruzados: 0 };
  const movimientos = await db.movimiento.findMany({
    where: { estado: { notIn: ['ANULADO', 'DUPLICADO'] }, OR: [{ cae: { not: null } }, { AND: [{ puntoVenta: { not: null } }, { numero: { not: null } }] }] },
    select: { id: true, cuitEmisor: true, tipoComprobante: true, puntoVenta: true, numero: true, cae: true, arcaEstado: true, origen: true },
  });
  const porCae = new Map<string, typeof movimientos>();
  const porClave = new Map<string, typeof movimientos>();
  for (const m of movimientos) {
    if (m.cae) porCae.set(m.cae.trim(), [...(porCae.get(m.cae.trim()) ?? []), m]);
    const pv = numero(m.puntoVenta);
    const nro = numero(m.numero);
    if (m.cuitEmisor && m.tipoComprobante && pv != null && nro != null) {
      const k = `${normalizarCuit(m.cuitEmisor)}|${m.tipoComprobante}|${pv}|${nro}`;
      porClave.set(k, [...(porClave.get(k) ?? []), m]);
    }
  }
  const cuitEmpresa = normalizarCuit(empresa.cuit);
  let cruzados = 0;
  for (const c of pendientes) {
    const cuitEmisor = c.origen === 'RECIBIDO' ? c.nroDocContraparte : cuitEmpresa;
    let candidatos = c.codigoAutorizacion ? (porCae.get(c.codigoAutorizacion.trim()) ?? []) : [];
    // Con CAE, el CUIT emisor tiene que coincidir si el movimiento lo tiene.
    candidatos = candidatos.filter((m) => !m.cuitEmisor || !cuitEmisor || normalizarCuit(m.cuitEmisor) === cuitEmisor);
    if (candidatos.length === 0 && cuitEmisor) {
      const tipo = TIPO_POR_CODIGO[c.tipoComprobante];
      if (tipo) candidatos = porClave.get(`${cuitEmisor}|${tipo}|${c.puntoVenta}|${c.numeroDesde}`) ?? [];
    }
    if (c.origen === 'EMITIDO') candidatos = candidatos.filter((m) => m.origen === 'VENTA_COMPROBANTE' || m.origen === 'VENTA_MANUAL' || normalizarCuit(m.cuitEmisor ?? '') === cuitEmpresa);
    const mov = candidatos[0];
    if (!mov) continue;
    await db.comprobanteArca.update({ where: { id: c.id }, data: { movimientoId: mov.id } });
    cruzados++;
    if (mov.arcaEstado !== 'VALIDO') {
      const detalle = `Figura en Mis Comprobantes de ARCA (${c.origen === 'EMITIDO' ? 'emitido' : 'recibido'}, ${c.fechaEmision.toISOString().slice(0, 10)})`;
      await db.movimiento.update({ where: { id: mov.id }, data: { arcaEstado: 'VALIDO', arcaDetalle: detalle, arcaConsultadoAt: new Date() } });
      await writeAudit(db, {
        usuarioId,
        entidad: 'Movimiento',
        entidadId: mov.id,
        accion: 'ARCA_CONSTATAR',
        antes: { arcaEstado: mov.arcaEstado },
        despues: { arcaEstado: 'VALIDO', fuente: 'MIS_COMPROBANTES', detalle, comprobanteArcaId: c.id },
      });
    }
  }
  return { cruzados };
}

// ---------- importación manual ----------

function cuitDelNombre(nombre: string): string | null {
  const m = nombre.match(/(?<!\d)(\d{11})(?!\d)/g);
  return m?.find((c) => cuitEsValido(c)) ?? null;
}

/**
 * Importa el CSV (o el ZIP tal como lo baja el portal) de Mis Comprobantes.
 * Verifica que sea de esta empresa: el CUIT del nombre del archivo, y en
 * recibidos el receptor de cada fila.
 */
export async function importarMisComprobantes(
  ctx: EmpresaContext,
  params: { contenido: Buffer; nombreArchivo: string },
): Promise<{ origen: OrigenMisComprobantes; filas: number; nuevos: number; actualizados: number; cruzados: number }> {
  const cuitEmpresa = normalizarCuit(ctx.empresa.cuit);
  const cuitArchivo = cuitDelNombre(params.nombreArchivo);
  if (cuitArchivo && cuitArchivo !== cuitEmpresa) {
    throw new DomainError(`El archivo es de otra empresa (CUIT ${formatearCuit(cuitArchivo)}), no de ${ctx.empresa.razonSocial}.`);
  }
  let texto: string;
  try {
    const esZip = params.contenido.length > 4 && params.contenido.readUInt32LE(0) === 0x04034b50;
    texto = esZip ? extraerCsvDeZip(params.contenido).contenido : params.contenido.toString('utf8');
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  let parsed: ReturnType<typeof parsearCsvMisComprobantes>;
  try {
    parsed = parsearCsvMisComprobantes(texto);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  if (parsed.origen === 'RECIBIDO') {
    const ajeno = parsed.filas.find((f) => f.nroDocReceptor && normalizarCuit(f.nroDocReceptor) !== cuitEmpresa);
    if (ajeno) throw new DomainError(`El CSV es de otra empresa: el receptor es ${formatearCuit(normalizarCuit(ajeno.nroDocReceptor!))}, no ${ctx.empresa.razonSocial}.`);
  }
  const guardado = await guardarFilasArca(ctx.db, ctx.empresa.id, parsed.origen, parsed.filas, 'CSV');
  const cruce = await cruzarComprobantesArca(ctx.db, ctx.empresa, ctx.usuario.id);
  await writeAudit(ctx.db, {
    usuarioId: ctx.usuario.id,
    entidad: 'Empresa',
    entidadId: ctx.empresa.id,
    accion: 'ARCA_IMPORTAR_CSV',
    despues: { archivo: params.nombreArchivo, origen: parsed.origen, filas: parsed.filas.length, ...guardado, ...cruce },
  });
  return { origen: parsed.origen, filas: parsed.filas.length, ...guardado, ...cruce };
}

// ---------- sync ----------

function partesArgentina(fecha: Date): { anio: number; mes: number; dia: number; hora: number; minuto: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_AR, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(fmt.formatToParts(fecha).map((x) => [x.type, x.value]));
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

/** Ventana del sync diario: los últimos 30 días hasta AYER (hora Argentina); ARCA publica hasta el día anterior. */
export function ventanaSyncDiaria(ahora: Date = new Date()): { desde: Date; hasta: Date } {
  const { anio, mes, dia } = partesArgentina(ahora);
  const hoy = Date.UTC(anio, mes - 1, dia);
  const hasta = new Date(hoy - 86400000);
  const desde = new Date(hasta.getTime() - DIAS_VENTANA_SYNC * 86400000);
  return { desde, hasta };
}

export type ResultadoSync =
  | { estado: 'OK'; emitidos: number; recibidos: number; nuevos: number; actualizados: number; cruzados: number; desde: Date; hasta: Date }
  | { estado: 'SIN_CREDENCIAL' }
  | { estado: 'BLOQUEADA'; motivo: string };

/**
 * Corrida de sync para una empresa (job diario o "Sincronizar ahora"). Un
 * login. Rechazo de ARCA → BLOQUEADA y devuelve sin lanzar (el job no debe
 * reintentar). Otro error → cuenta error seguido, se propaga (el job
 * reintenta con backoff, las credenciales ya se sabían buenas).
 */
export async function sincronizarMisComprobantes(
  empresaId: string,
  params: { desde?: Date; hasta?: Date; usuarioId?: string | null } = {},
  deps: DepsArca = {},
): Promise<ResultadoSync> {
  const d = { ...depsReales, ...deps };
  const db = scopedDb(empresaId);
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } });
  const cred = await db.credencialArca.findFirst({ where: {} });
  if (!cred) return { estado: 'SIN_CREDENCIAL' };
  if (cred.estado === 'BLOQUEADA') return { estado: 'BLOQUEADA', motivo: cred.motivoBloqueo ?? 'credencial bloqueada' };
  const ventana = ventanaSyncDiaria();
  const desde = params.desde ?? ventana.desde;
  const hasta = params.hasta ?? ventana.hasta;
  const usuarioId = params.usuarioId ?? null;

  await db.credencialArca.update({ where: { id: cred.id }, data: { ultimoIntentoAt: new Date() } });
  let descarga: ResultadoDescarga;
  try {
    descarga = await d.descargar({ cuitUsuario: cred.cuitUsuario, clave: descifrarSecreto(cred.claveCifrada), cuitEmpresa: empresa.cuit, desde, hasta });
  } catch (e) {
    if (e instanceof ErrorLoginArca) {
      await bloquearCredencial(db, cred.id, e.message, usuarioId);
      return { estado: 'BLOQUEADA', motivo: e.message };
    }
    const mensaje = e instanceof Error ? e.message : String(e);
    await db.credencialArca.update({ where: { id: cred.id }, data: { ultimoErrorSync: mensaje, erroresSeguidos: { increment: 1 } } });
    await writeAudit(db, { usuarioId, entidad: 'CredencialArca', entidadId: cred.id, accion: 'ARCA_SYNC_ERROR', despues: { error: mensaje, desde, hasta } });
    throw e;
  }

  const e = await guardarFilasArca(db, empresaId, 'EMITIDO', descarga.emitidos, 'PORTAL');
  const r = await guardarFilasArca(db, empresaId, 'RECIBIDO', descarga.recibidos, 'PORTAL');
  const cruce = await cruzarComprobantesArca(db, empresa, usuarioId);
  await db.credencialArca.update({
    where: { id: cred.id },
    data: { estado: 'OK', motivoBloqueo: null, ultimoOkAt: new Date(), ultimaSyncAt: new Date(), ultimoErrorSync: null, erroresSeguidos: 0 },
  });
  const resultado = {
    estado: 'OK' as const,
    emitidos: descarga.emitidos.length,
    recibidos: descarga.recibidos.length,
    nuevos: e.nuevos + r.nuevos,
    actualizados: e.actualizados + r.actualizados,
    cruzados: cruce.cruzados,
    desde,
    hasta,
  };
  await writeAudit(db, { usuarioId, entidad: 'CredencialArca', entidadId: cred.id, accion: 'ARCA_SYNC', despues: resultado });
  return resultado;
}

/**
 * Programador del job diario (lo llama el worker cada minuto): a partir de
 * las 06:30 hora Argentina, encola una corrida por empresa con credencial OK
 * y sync automático, una sola vez por día.
 */
export async function encolarSyncsPendientes(ahora: Date = new Date()): Promise<number> {
  const { anio, mes, dia, hora, minuto } = partesArgentina(ahora);
  if (hora * 60 + minuto < HORA_SYNC_AR.hora * 60 + HORA_SYNC_AR.minuto) return 0;
  // Inicio del día en Argentina expresado en UTC (AR = UTC-3, sin horario de verano).
  const inicioDia = new Date(Date.UTC(anio, mes - 1, dia, 3, 0, 0));
  const credenciales = await prisma.credencialArca.findMany({ where: { estado: 'OK', syncAutomatico: true } });
  let encolados = 0;
  for (const c of credenciales) {
    const yaHoy = await prisma.job.findFirst({ where: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: c.empresaId, createdAt: { gte: inicioDia } }, select: { id: true } });
    if (yaHoy) continue;
    await prisma.job.create({ data: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: c.empresaId, payload: { empresaId: c.empresaId, disparo: 'diario' } as never, maxIntentos: 2 } });
    encolados++;
  }
  return encolados;
}

/** "Sincronizar ahora" desde la pantalla ARCA: encola una corrida a nombre del usuario. */
export async function encolarSyncManual(ctx: EmpresaContext): Promise<void> {
  const cred = await ctx.db.credencialArca.findFirst({ where: {} });
  if (!cred) throw new DomainError('Primero guardá y probá la Clave Fiscal en Configuración.');
  if (cred.estado === 'BLOQUEADA') throw new DomainError('La credencial de ARCA está bloqueada: verificá la Clave Fiscal en Configuración.');
  if (cred.estado === 'SIN_PROBAR') throw new DomainError('Probá el ingreso a ARCA en Configuración antes de sincronizar.');
  const enCurso = await prisma.job.findFirst({ where: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: ctx.empresa.id, estado: { in: ['queued', 'processing'] } } });
  if (enCurso) throw new DomainError('Ya hay una sincronización en curso.');
  await enqueueJob('SYNC_MIS_COMPROBANTES', { empresaId: ctx.empresa.id, usuarioId: ctx.usuario.id, disparo: 'manual' }, ctx.empresa.id);
  await prisma.job.updateMany({ where: { tipo: 'SYNC_MIS_COMPROBANTES', empresaId: ctx.empresa.id, estado: 'queued' }, data: { maxIntentos: 2 } });
}

