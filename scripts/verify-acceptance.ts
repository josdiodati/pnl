// Walks the doc-10 acceptance criteria that are verifiable at the service
// layer, against the seeded database. HTTP-level criteria (login, 403,
// webhooks) are exercised separately with curl — see README.
// Run: npx tsx scripts/verify-acceptance.ts   (requires seed applied + DB up)
import { PrismaClient } from '@prisma/client';
import { scopedDb } from '../lib/empresa/scope';
import type { EmpresaContext } from '../lib/empresa/require-empresa';
import {
  validarMovimiento,
  anularMovimiento,
  cerrarPeriodo,
  reabrirPeriodo,
  generarRecurrentes,
  crearVentaManual,
} from '../lib/movimientos/service';
import { ingestarComprobante, procesarExtraccion, procesarArca } from '../lib/pipeline';
import { resumirMovimientos } from '../lib/movimientos/query';
import { makeFacturaPdf } from '../prisma/pdf';
import { DomainError } from '../lib/errors';

const prisma = new PrismaClient();
const resultados: { criterio: string; ok: boolean; detalle: string }[] = [];

function reportar(criterio: string, ok: boolean, detalle: string) {
  resultados.push({ criterio, ok, detalle });
  console.log(`${ok ? '✔' : '✘'} ${criterio}: ${detalle}`);
}

async function ctxDe(slugEmpresa: string, email: string): Promise<EmpresaContext> {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  const membresia = await prisma.usuarioEmpresa.findFirstOrThrow({
    where: { usuarioId: usuario.id, empresa: { slug: slugEmpresa } },
    include: { empresa: true },
  });
  return {
    empresa: membresia.empresa,
    usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
    rol: membresia.rol,
    db: scopedDb(membresia.empresa.id),
  };
}

async function main() {
  const ctx = await ctxDe('empresa-alfa', 'admin@demo.test');
  const db = ctx.db;
  const hoy = new Date();
  const m0 = { anio: hoy.getUTCFullYear(), mes: hoy.getUTCMonth() + 1 };

  const [bpo, sf] = await Promise.all([
    db.centroCosto.findFirstOrThrow({ where: { nombre: 'BPO' } }),
    db.centroCosto.findFirstOrThrow({ where: { nombre: 'SF' } }),
  ]);
  const telecom = await db.cliente.findFirstOrThrow({ where: { nombre: 'Cliente Telecom' } });
  const catIt = await db.categoria.findFirstOrThrow({ where: { nombre: 'IT & COM Services' } });

  // ---- Criterio 3: captura + OCR + asignación 60/40 con cliente/proyecto ----
  const pdf = makeFacturaPdf({
    razonSocialEmisor: 'TechNet Servicios S.A.',
    cuitEmisor: '20128364847',
    tipoComprobante: 'FACTURA_A',
    puntoVenta: '0003',
    numero: '00004600',
    fechaEmision: `${m0.anio}-${String(m0.mes).padStart(2, '0')}-05`,
    netoGravado: 100000,
    iva21: 21000,
    total: 121000,
    cae: '74777777777771',
    vencimientoCae: `${m0.anio}-${String(m0.mes).padStart(2, '0')}-15`,
  });
  const { movimientoId } = await ingestarComprobante({
    empresaId: ctx.empresa.id,
    usuarioId: ctx.usuario.id,
    buffer: pdf,
    filename: 'verificacion-c3.pdf',
    mime: 'application/pdf',
    canal: 'WEB',
  });
  await procesarExtraccion({ movimientoId, empresaId: ctx.empresa.id });
  await procesarArca({ movimientoId, empresaId: ctx.empresa.id });
  let mov = await db.movimiento.findFirstOrThrow({ where: { id: movimientoId }, include: { lineas: true } });
  const extraccionOk =
    mov.estado === 'PENDIENTE_VALIDACION' &&
    Number(mov.total) === 121000 &&
    mov.cuitEmisor === '20128364847' &&
    mov.contraparteId !== null &&
    mov.categoriaId === catIt.id &&
    mov.lineas.length === 3; // distribución default del proveedor precargada
  reportar('3a extracción', extraccionOk, `estado=${mov.estado} total=${mov.total} contraparte=${mov.contraparteId ? 'matcheada' : 'NO'} lineas=${mov.lineas.length}`);

  await validarMovimiento(ctx, movimientoId, {
    fechaDevengamiento: `${m0.anio}-${String(m0.mes).padStart(2, '0')}-05`,
    categoriaId: catIt.id,
    contraparteId: mov.contraparteId,
    importes: { total: 121000, netoGravado: 100000, iva21: 21000 },
    lineas: [
      { centroCostoId: bpo.id, clienteId: telecom.id, porcentaje: 60 },
      { centroCostoId: sf.id, porcentaje: 40 },
    ],
  });
  mov = await db.movimiento.findFirstOrThrow({ where: { id: movimientoId }, include: { lineas: true } });
  const importes = mov.lineas.map((l) => (-121000 * Number(l.porcentaje)) / 100);
  reportar(
    '3b validación 60/40',
    mov.estado === 'VALIDADO' && mov.lineas.length === 2,
    `estado=${mov.estado}; importes por línea ≈ ${importes.map((i) => i.toFixed(2)).join(' / ')} (suman ${importes.reduce((a, b) => a + b, 0).toFixed(2)})`,
  );

  // ---- Criterio 4: doble dimensión, total por cliente/proyecto ----
  const movsTelecom = await db.movimiento.findMany({
    where: { lineas: { some: { clienteId: telecom.id } }, estado: 'VALIDADO' },
    include: { categoria: true, lineas: true },
  });
  const resumenTelecom = resumirMovimientos(movsTelecom as never);
  const totalTelecom = resumenTelecom.porCliente.get(telecom.id) ?? 0;
  reportar('4 filtro por cliente/proyecto', movsTelecom.length >= 2 && totalTelecom !== 0,
    `${movsTelecom.length} movimientos validados con Cliente Telecom; total asignado $${(totalTelecom / 100).toFixed(2)}`);

  // ---- Criterio 5: ARCA inválido exige confirmación extra, auditada ----
  const invalido = await db.movimiento.findFirstOrThrow({ where: { arcaEstado: 'INVALIDO', estado: 'PENDIENTE_VALIDACION' } });
  let bloqueado = false;
  try {
    await validarMovimiento(ctx, invalido.id, {
      fechaDevengamiento: invalido.fechaDevengamiento!.toISOString().slice(0, 10),
      categoriaId: invalido.categoriaId!,
      contraparteId: invalido.contraparteId,
      lineas: [{ centroCostoId: bpo.id, porcentaje: 100 }],
    });
  } catch (e) {
    bloqueado = e instanceof DomainError;
  }
  await validarMovimiento(ctx, invalido.id, {
    fechaDevengamiento: invalido.fechaDevengamiento!.toISOString().slice(0, 10),
    categoriaId: invalido.categoriaId!,
    contraparteId: invalido.contraparteId,
    confirmarArcaInvalido: true,
    lineas: [{ centroCostoId: bpo.id, porcentaje: 100 }],
  });
  const auditConfirm = await db.auditLog.findFirst({
    where: { entidad: 'Movimiento', entidadId: invalido.id, accion: 'VALIDAR' },
    orderBy: { createdAt: 'desc' },
  });
  const confirmEnAudit = JSON.stringify(auditConfirm?.despues ?? {}).includes('arcaInvalidoConfirmadoPorValidador');
  reportar('5 ARCA inválido', bloqueado && confirmEnAudit,
    `sin confirmación → bloqueado=${bloqueado}; con confirmación → validado y auditado=${confirmEnAudit}`);

  // ---- Criterio 6: duplicados (misma factura dos veces) ----
  const { movimientoId: dupId } = await ingestarComprobante({
    empresaId: ctx.empresa.id,
    usuarioId: ctx.usuario.id,
    buffer: pdf, // same voucher as criterion 3
    filename: 'verificacion-c6-duplicado.pdf',
    mime: 'application/pdf',
    canal: 'WEB',
  });
  await procesarExtraccion({ movimientoId: dupId, empresaId: ctx.empresa.id });
  const dup = await db.movimiento.findFirstOrThrow({ where: { id: dupId } });
  const flagsDup = (dup.flags as { duplicados?: string[] } | null)?.duplicados ?? [];
  reportar('6 duplicados', flagsDup.includes(movimientoId), `la segunda subida alerta duplicado de ${flagsDup.length} movimiento(s)`);

  // ---- Criterio 7: retenido en mes cerrado → reabrir (admin, auditado) → validar → cerrar ----
  const retenido = await db.movimiento.findFirstOrThrow({ where: { estado: 'RETENIDO' } });
  const fechaRet = retenido.fechaDevengamiento!;
  const ymRet = { anio: fechaRet.getUTCFullYear(), mes: fechaRet.getUTCMonth() + 1 };
  let validarEnCerradoFalla = false;
  try {
    await validarMovimiento(ctx, retenido.id, {
      fechaDevengamiento: fechaRet.toISOString().slice(0, 10),
      categoriaId: retenido.categoriaId!,
      contraparteId: retenido.contraparteId,
      lineas: [{ centroCostoId: bpo.id, porcentaje: 100 }],
    });
  } catch (e) {
    validarEnCerradoFalla = e instanceof DomainError;
  }
  await reabrirPeriodo(ctx, ymRet.anio, ymRet.mes, 'Verificación: factura llegó tarde, hay que imputarla');
  await validarMovimiento(ctx, retenido.id, {
    fechaDevengamiento: fechaRet.toISOString().slice(0, 10),
    categoriaId: retenido.categoriaId!,
    contraparteId: retenido.contraparteId,
    lineas: [
      { centroCostoId: bpo.id, porcentaje: 70 },
      { centroCostoId: sf.id, porcentaje: 30 },
    ],
  });
  await cerrarPeriodo(ctx, ymRet.anio, ymRet.mes);
  const periodoRecerrado = await db.periodo.findFirstOrThrow({ where: { anio: ymRet.anio, mes: ymRet.mes } });
  const auditReapertura = await db.auditLog.findFirst({ where: { entidad: 'Periodo', accion: 'REABRIR' } });
  reportar('7 devengado + cierre', validarEnCerradoFalla && periodoRecerrado.estado === 'CERRADO' && !!auditReapertura,
    `validar en cerrado falla=${validarEnCerradoFalla}; reapertura auditada con motivo=${!!auditReapertura}; re-cerrado=${periodoRecerrado.estado}`);

  // ---- Criterio 8: no se puede cerrar un mes con pendientes ----
  let cierreBloqueado = '';
  try {
    await cerrarPeriodo(ctx, m0.anio, m0.mes);
  } catch (e) {
    if (e instanceof DomainError) cierreBloqueado = e.message;
  }
  reportar('8 cierre con pendientes', cierreBloqueado.includes('pendiente'), cierreBloqueado || 'NO BLOQUEÓ');

  // ---- Criterio 9: generar recurrentes del mes ----
  const r = await generarRecurrentes(ctx, m0.anio, m0.mes);
  const legalesGenerado = await db.movimiento.findFirst({
    where: {
      estado: 'PENDIENTE_VALIDACION',
      descripcion: { contains: 'Honorarios Legales' },
      fechaDevengamiento: { gte: new Date(Date.UTC(m0.anio, m0.mes - 1, 1)) },
    },
  });
  reportar('9 recurrentes', r.creados >= 1 && !!legalesGenerado && r.salteados >= 1,
    `creados=${r.creados} (Honorarios Legales), salteados=${r.salteados} (Sueldos BPO ya existía)`);

  // ---- Criterio 10: venta manual refleja en mini-resumen ----
  const catVentas = await db.categoria.findFirstOrThrow({ where: { nombre: 'Ventas HW' } });
  const antesResumen = resumirMovimientos(
    (await db.movimiento.findMany({ include: { categoria: true, lineas: true } })) as never,
  );
  await crearVentaManual(ctx, {
    fechaDevengamiento: `${m0.anio}-${String(m0.mes).padStart(2, '0')}-11`,
    categoriaId: catVentas.id,
    total: 605000,
    importes: { netoGravado: 500000, iva21: 105000, total: 605000 },
    descripcion: 'Venta HW verificación',
    tipoComprobante: 'FACTURA_A',
    lineas: [{ centroCostoId: sf.id, porcentaje: 100 }],
    validarAlGuardar: true,
  });
  const despuesResumen = resumirMovimientos(
    (await db.movimiento.findMany({ include: { categoria: true, lineas: true } })) as never,
  );
  reportar('10 venta manual', despuesResumen.ingresos - antesResumen.ingresos === 60500000,
    `ingresos +$${((despuesResumen.ingresos - antesResumen.ingresos) / 100).toFixed(2)} en el mini-resumen`);

  // ---- Criterio 11: anulación con motivo, fuera de totales, en historial ----
  const aAnular = await db.movimiento.findFirstOrThrow({ where: { id: movimientoId } }); // el validado en C3
  const resAntes = resumirMovimientos((await db.movimiento.findMany({ include: { categoria: true, lineas: true } })) as never);
  await anularMovimiento(ctx, aAnular.id, 'Verificación: anulación de prueba con motivo obligatorio');
  const resDespues = resumirMovimientos((await db.movimiento.findMany({ include: { categoria: true, lineas: true } })) as never);
  const anulado = await db.movimiento.findFirstOrThrow({ where: { id: aAnular.id } });
  const auditAnulacion = await db.auditLog.findFirst({ where: { entidadId: aAnular.id, accion: 'ANULAR' } });
  reportar('11 anulación', anulado.estado === 'ANULADO' && !!anulado.motivoAnulacion && !!auditAnulacion && resDespues.egresos !== resAntes.egresos,
    `estado=${anulado.estado}, motivo registrado, auditado, egresos pasaron de $${(resAntes.egresos / 100).toFixed(2)} a $${(resDespues.egresos / 100).toFixed(2)}`);

  // ---- Resumen ----
  const fallas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} verificaciones OK${fallas.length ? ` — FALLAS: ${fallas.map((f) => f.criterio).join(', ')}` : ''}`);
  if (fallas.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
