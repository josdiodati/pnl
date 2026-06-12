// Demo seed (doc 10): two users, two companies with different roles, full
// masters inspired by the real case, ~16 movements across 3 months (one month
// CLOSED) in every state, and sample PDFs with a mock-OCR marker.
// Run with: npx prisma db seed   (idempotent: skips if already applied)
import { PrismaClient, type TipoCategoria, type EstadoMovimiento } from '@prisma/client';
import { hashPassword } from '../lib/auth/password';
import { getFileStorage } from '../lib/storage';
import { makeFacturaPdf } from './pdf';

const prisma = new PrismaClient();

const PASSWORD_DEMO = 'demo1234';

function mesRelativo(offset: number): { anio: number; mes: number } {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

function fecha(ym: { anio: number; mes: number }, dia: number): Date {
  const ultimo = new Date(Date.UTC(ym.anio, ym.mes, 0)).getUTCDate();
  return new Date(Date.UTC(ym.anio, ym.mes - 1, Math.min(dia, ultimo)));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (await prisma.usuario.findUnique({ where: { email: 'admin@demo.test' } })) {
    console.log('El seed ya fue aplicado (existe admin@demo.test). Nada que hacer.');
    return;
  }

  const passwordHash = await hashPassword(PASSWORD_DEMO);
  const admin = await prisma.usuario.create({
    data: { email: 'admin@demo.test', nombre: 'Ana Admin', passwordHash },
  });
  const operador = await prisma.usuario.create({
    data: { email: 'operador@demo.test', nombre: 'Omar Operador', passwordHash },
  });

  const alfa = await prisma.empresa.create({
    data: {
      slug: 'empresa-alfa',
      razonSocial: 'Empresa Alfa S.A.',
      cuit: '30711111111',
      inicioEjercicioFiscal: 7,
      telegramCodigoVinculo: 'ALFA1234',
      usuarios: {
        create: [
          { usuarioId: admin.id, rol: 'ADMINISTRADOR' },
          { usuarioId: operador.id, rol: 'CARGADOR' },
        ],
      },
    },
  });
  const beta = await prisma.empresa.create({
    data: {
      slug: 'empresa-beta',
      razonSocial: 'Empresa Beta S.R.L.',
      cuit: '27333333339',
      inicioEjercicioFiscal: 7,
      usuarios: { create: [{ usuarioId: admin.id, rol: 'VALIDADOR' }] },
    },
  });

  // ---------- Masters ----------
  const NOMBRES_CATEGORIAS: [string, TipoCategoria][] = [
    ['Ventas BPO', 'INGRESO'],
    ['Ventas SF', 'INGRESO'],
    ['Ventas HW', 'INGRESO'],
    ['Sueldos', 'EGRESO'],
    ['Adicionales Salarios', 'EGRESO'],
    ['IT & COM Services', 'EGRESO'],
    ['Office Supplies', 'EGRESO'],
    ['Office Expenditure', 'EGRESO'],
    ['Legales', 'EGRESO'],
    ['Contables', 'EGRESO'],
    ['Representación', 'EGRESO'],
    ['Impuestos', 'EGRESO'],
    ['Gastos Bancarios', 'EGRESO'],
    ['Misceláneos', 'EGRESO'],
  ];

  async function crearMaestros(empresaId: string) {
    const cat: Record<string, string> = {};
    for (const [nombre, tipo] of NOMBRES_CATEGORIAS) {
      const c = await prisma.categoria.create({ data: { empresaId, nombre, tipo } });
      cat[nombre] = c.id;
    }
    const bpo = await prisma.centroCosto.create({ data: { empresaId, nombre: 'BPO', tipo: 'NEGOCIO' } });
    const sf = await prisma.centroCosto.create({ data: { empresaId, nombre: 'SF', tipo: 'NEGOCIO' } });
    const adm = await prisma.centroCosto.create({ data: { empresaId, nombre: 'Administración', tipo: 'SOPORTE' } });

    const telecom = await prisma.clienteProyecto.create({ data: { empresaId, nombre: 'Cliente Telecom', codigo: 'TEL' } });
    const retail = await prisma.clienteProyecto.create({ data: { empresaId, nombre: 'Cliente Retail', codigo: 'RET' } });
    const interno = await prisma.clienteProyecto.create({ data: { empresaId, nombre: 'Interno', codigo: 'INT' } });

    const distAlquiler = await prisma.plantillaDistribucion.create({
      data: {
        empresaId,
        nombre: 'Alquiler 60/30/10',
        lineas: {
          create: [
            { centroCostoId: bpo.id, porcentaje: 60 },
            { centroCostoId: sf.id, porcentaje: 30 },
            { centroCostoId: adm.id, porcentaje: 10 },
          ],
        },
      },
    });
    const distIt = await prisma.plantillaDistribucion.create({
      data: {
        empresaId,
        nombre: 'IT 70/20/10',
        lineas: {
          create: [
            { centroCostoId: bpo.id, porcentaje: 70 },
            { centroCostoId: sf.id, porcentaje: 20 },
            { centroCostoId: adm.id, porcentaje: 10 },
          ],
        },
      },
    });

    return { cat, bpo, sf, adm, telecom, retail, interno, distAlquiler, distIt };
  }

  const mA = await crearMaestros(alfa.id);
  const mB = await crearMaestros(beta.id);

  // ~10 contrapartes with VALID check digits (some with defaults)
  const contrapartesAlfa = [
    { cuit: '30714325651', razonSocial: 'Inmobiliaria Centro S.R.L.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Office Expenditure'], distribucionDefaultId: mA.distAlquiler.id },
    { cuit: '20128364847', razonSocial: 'TechNet Servicios S.A.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['IT & COM Services'], distribucionDefaultId: mA.distIt.id },
    { cuit: '27234567891', razonSocial: 'Papelera Mitre S.A.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Office Supplies'] },
    { cuit: '30500010912', razonSocial: 'Estudio Contable Pérez y Asoc.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Contables'] },
    { cuit: '30700000008', razonSocial: 'Estudio Jurídico Lex S.C.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Legales'] },
    { cuit: '27300000008', razonSocial: 'Banco Provincia', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Gastos Bancarios'] },
    { cuit: '30600000000', razonSocial: 'Telecom Argentina S.A.', tipo: 'CLIENTE' },
    { cuit: '20400000000', razonSocial: 'Retail Express S.A.', tipo: 'CLIENTE' },
    { cuit: '30550000004', razonSocial: 'Catering Sur S.R.L.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Representación'] },
    { cuit: '20555555556', razonSocial: 'Limpieza Total S.R.L.', tipo: 'PROVEEDOR', categoriaDefaultId: mA.cat['Office Expenditure'] },
  ] as const;
  const cpA: Record<string, string> = {};
  for (const c of contrapartesAlfa) {
    const creada = await prisma.contraparte.create({ data: { empresaId: alfa.id, ...c } });
    cpA[c.razonSocial] = creada.id;
  }
  const cpB: Record<string, string> = {};
  for (const c of [
    { cuit: '30666666662', razonSocial: 'Proveedor Beta Uno S.A.', tipo: 'PROVEEDOR' as const, categoriaDefaultId: mB.cat['Misceláneos'] },
    { cuit: '30711111111', razonSocial: 'Cliente Banco S.A.', tipo: 'CLIENTE' as const },
  ]) {
    const creada = await prisma.contraparte.create({ data: { empresaId: beta.id, ...c } });
    cpB[c.razonSocial] = creada.id;
  }

  // Recurring templates
  const recLegales = await prisma.plantillaRecurrente.create({
    data: {
      empresaId: alfa.id,
      nombre: 'Honorarios Legales',
      categoriaId: mA.cat['Legales'],
      importeSugerido: 350000,
      diaDelMes: 5,
      descripcion: 'Abono mensual Estudio Lex',
    },
  });
  const recSueldos = await prisma.plantillaRecurrente.create({
    data: {
      empresaId: alfa.id,
      nombre: 'Sueldos BPO',
      categoriaId: mA.cat['Sueldos'],
      importeSugerido: 2500000,
      diaDelMes: 1,
      usarImporteMesAnterior: true,
      descripcion: 'Nómina del sector BPO',
    },
  });

  // ---------- Periods: 3 consecutive months, oldest CLOSED ----------
  const m0 = mesRelativo(0);
  const m1 = mesRelativo(-1);
  const m2 = mesRelativo(-2);

  const periodos: Record<string, string> = {};
  for (const [empresaId, metas] of [
    [alfa.id, [m2, m1, m0]],
    [beta.id, [m1, m0]],
  ] as const) {
    for (const ym of metas) {
      const p = await prisma.periodo.create({
        data: {
          empresaId,
          anio: ym.anio,
          mes: ym.mes,
          ...(empresaId === alfa.id && ym === m2
            ? { estado: 'CERRADO', cerradoPorId: admin.id, cerradoAt: new Date() }
            : {}),
        },
      });
      periodos[`${empresaId}:${ym.anio}-${ym.mes}`] = p.id;
    }
  }
  await prisma.auditLog.create({
    data: {
      empresaId: alfa.id,
      usuarioId: admin.id,
      entidad: 'Periodo',
      entidadId: periodos[`${alfa.id}:${m2.anio}-${m2.mes}`],
      accion: 'CERRAR',
      despues: { anio: m2.anio, mes: m2.mes },
    },
  });

  // ---------- Sample PDFs (mock-OCR marker inside) ----------
  const storage = getFileStorage();
  async function pdfFactura(d: Parameters<typeof makeFacturaPdf>[0], filename: string) {
    const buffer = makeFacturaPdf(d);
    const { key, hash } = await storage.put(buffer, { filename, mime: 'application/pdf', empresaId: alfa.id });
    return { key, hash, nombre: filename };
  }

  const pdfAlquiler = await pdfFactura(
    {
      razonSocialEmisor: 'Inmobiliaria Centro S.R.L.',
      cuitEmisor: '30714325651',
      tipoComprobante: 'FACTURA_A',
      puntoVenta: '0002',
      numero: '00001200',
      fechaEmision: ymd(fecha(m2, 3)),
      netoGravado: 1000000,
      iva21: 210000,
      total: 1210000,
      cae: '74111111111115',
      vencimientoCae: ymd(fecha(m2, 13)),
    },
    'factura-alquiler-inmobiliaria.pdf',
  );
  const pdfTechnet = await pdfFactura(
    {
      razonSocialEmisor: 'TechNet Servicios S.A.',
      cuitEmisor: '20128364847',
      tipoComprobante: 'FACTURA_A',
      puntoVenta: '0003',
      numero: '00004521',
      fechaEmision: ymd(fecha(m0, 4)),
      netoGravado: 250000,
      iva21: 52500,
      total: 302500,
      cae: '74123456789015',
      vencimientoCae: ymd(fecha(m0, 14)),
    },
    'factura-technet-servicios.pdf',
  );
  const pdfPapelera = await pdfFactura(
    {
      razonSocialEmisor: 'Papelera Mitre S.A.',
      cuitEmisor: '27234567891',
      tipoComprobante: 'FACTURA_A',
      puntoVenta: '0001',
      numero: '00000777',
      fechaEmision: ymd(fecha(m0, 6)),
      netoGravado: 80000,
      iva21: 16800,
      total: 96800,
      cae: '74999999999900', // ends in 00 -> ARCA mock says INVALIDO
      vencimientoCae: ymd(fecha(m0, 16)),
    },
    'factura-papelera-arca-invalida.pdf',
  );

  // ---------- Movements ----------
  type LineaSeed = { centroCostoId: string; clienteProyectoId?: string | null; porcentaje: number };

  async function crearMov(opts: {
    empresaId: string;
    origen: 'COMPROBANTE' | 'ASIENTO_MANUAL' | 'VENTA_MANUAL';
    estado: EstadoMovimiento;
    ym: { anio: number; mes: number };
    dia: number;
    categoria?: string | null;
    contraparteId?: string | null;
    descripcion: string;
    total: number;
    neto?: number | null;
    iva21?: number | null;
    tipoComprobante?: string | null;
    puntoVenta?: string | null;
    numero?: string | null;
    cuitEmisor?: string | null;
    cae?: string | null;
    arcaEstado?: string;
    canal: string;
    creadoPorId: string;
    validado?: boolean;
    motivoAnulacion?: string | null;
    lineas: LineaSeed[];
    archivo?: { key: string; hash: string; nombre: string } | null;
    camposRevisar?: Record<string, string>;
    flags?: Record<string, unknown>;
  }) {
    const f = fecha(opts.ym, opts.dia);
    const mov = await prisma.movimiento.create({
      data: {
        empresaId: opts.empresaId,
        origen: opts.origen,
        estado: opts.estado,
        fechaDevengamiento: f,
        periodoId: periodos[`${opts.empresaId}:${opts.ym.anio}-${opts.ym.mes}`] ?? null,
        categoriaId: opts.categoria ?? null,
        contraparteId: opts.contraparteId ?? null,
        descripcion: opts.descripcion,
        total: opts.total,
        netoGravado: opts.neto ?? null,
        iva21: opts.iva21 ?? null,
        tipoComprobante: opts.tipoComprobante ?? null,
        puntoVenta: opts.puntoVenta ?? null,
        numero: opts.numero ?? null,
        cuitEmisor: opts.cuitEmisor ?? null,
        cae: opts.cae ?? null,
        arcaEstado: opts.arcaEstado ?? 'NO_VERIFICADO',
        arcaConsultadoAt: opts.arcaEstado && opts.arcaEstado !== 'NO_VERIFICADO' ? new Date() : null,
        canalIngreso: opts.canal,
        creadoPorId: opts.creadoPorId,
        validadoPorId: opts.validado || opts.estado === 'VALIDADO' || opts.estado === 'ANULADO' ? admin.id : null,
        motivoAnulacion: opts.motivoAnulacion ?? null,
        camposRevisar: (opts.camposRevisar ?? undefined) as never,
        flags: (opts.flags ?? undefined) as never,
        ...(opts.archivo
          ? { archivoKey: opts.archivo.key, archivoHash: opts.archivo.hash, archivoNombre: opts.archivo.nombre, archivoMime: 'application/pdf' }
          : {}),
        lineas: { create: opts.lineas.map((l) => ({ centroCostoId: l.centroCostoId, clienteProyectoId: l.clienteProyectoId ?? null, porcentaje: l.porcentaje })) },
      },
    });
    await prisma.auditLog.create({
      data: { empresaId: opts.empresaId, usuarioId: opts.creadoPorId, entidad: 'Movimiento', entidadId: mov.id, accion: 'CREAR', despues: { origen: opts.origen, canal: opts.canal, total: opts.total } },
    });
    if (opts.estado === 'VALIDADO' || opts.estado === 'ANULADO') {
      await prisma.auditLog.create({
        data: { empresaId: opts.empresaId, usuarioId: admin.id, entidad: 'Movimiento', entidadId: mov.id, accion: 'VALIDAR', despues: { estado: 'VALIDADO' } },
      });
    }
    if (opts.estado === 'ANULADO') {
      await prisma.auditLog.create({
        data: { empresaId: opts.empresaId, usuarioId: admin.id, entidad: 'Movimiento', entidadId: mov.id, accion: 'ANULAR', antes: { estado: 'VALIDADO' }, despues: { estado: 'ANULADO', motivo: opts.motivoAnulacion } },
      });
    }
    if (opts.estado === 'OBSERVADO') {
      await prisma.auditLog.create({
        data: { empresaId: opts.empresaId, usuarioId: admin.id, entidad: 'Movimiento', entidadId: mov.id, accion: 'OBSERVAR', despues: { nota: (opts.flags as { notaObservacion?: string } | undefined)?.notaObservacion ?? null } },
      });
    }
    return mov;
  }

  // --- Alfa, month M-2 (CLOSED) ---
  await crearMov({
    empresaId: alfa.id, origen: 'ASIENTO_MANUAL', estado: 'VALIDADO', ym: m2, dia: 1,
    categoria: mA.cat['Sueldos'], descripcion: `Sueldos BPO (recurrente)`, total: 2400000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mA.bpo.id, porcentaje: 100 }],
    flags: { plantillaRecurrenteId: recSueldos.id },
  });
  await crearMov({
    empresaId: alfa.id, origen: 'ASIENTO_MANUAL', estado: 'VALIDADO', ym: m2, dia: 1,
    categoria: mA.cat['Sueldos'], descripcion: 'Sueldos Administración', total: 900000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mA.adm.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'VALIDADO', ym: m2, dia: 3,
    categoria: mA.cat['Office Expenditure'], contraparteId: cpA['Inmobiliaria Centro S.R.L.'],
    descripcion: 'Alquiler oficina central', total: 1210000, neto: 1000000, iva21: 210000,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0002', numero: '00001200', cuitEmisor: '30714325651',
    cae: '74111111111115', arcaEstado: 'VALIDO', canal: 'WEB', creadoPorId: operador.id,
    archivo: pdfAlquiler,
    lineas: [
      { centroCostoId: mA.bpo.id, porcentaje: 60 },
      { centroCostoId: mA.sf.id, porcentaje: 30 },
      { centroCostoId: mA.adm.id, porcentaje: 10 },
    ],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'VENTA_MANUAL', estado: 'VALIDADO', ym: m2, dia: 28,
    categoria: mA.cat['Ventas BPO'], contraparteId: cpA['Telecom Argentina S.A.'],
    descripcion: 'Servicios BPO cuenta Telecom', total: 4840000, neto: 4000000, iva21: 840000,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0001', numero: '00000045',
    canal: 'MANUAL', creadoPorId: admin.id,
    lineas: [{ centroCostoId: mA.bpo.id, clienteProyectoId: mA.telecom.id, porcentaje: 100 }],
  });
  // Voucher dated in the CLOSED month, arrived late -> RETENIDO
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'RETENIDO', ym: m2, dia: 25,
    categoria: mA.cat['IT & COM Services'], contraparteId: cpA['TechNet Servicios S.A.'],
    descripcion: 'Comprobante de TechNet Servicios S.A.', total: 181500, neto: 150000, iva21: 31500,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0003', numero: '00004410', cuitEmisor: '20128364847',
    cae: '74222222222226', arcaEstado: 'VALIDO', canal: 'EMAIL', creadoPorId: admin.id,
    lineas: [
      { centroCostoId: mA.bpo.id, porcentaje: 70 },
      { centroCostoId: mA.sf.id, porcentaje: 20 },
      { centroCostoId: mA.adm.id, porcentaje: 10 },
    ],
  });

  // --- Alfa, month M-1 ---
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'VALIDADO', ym: m1, dia: 8,
    categoria: mA.cat['IT & COM Services'], contraparteId: cpA['TechNet Servicios S.A.'],
    descripcion: 'Soporte IT y enlaces', total: 423500, neto: 350000, iva21: 73500,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0003', numero: '00004488', cuitEmisor: '20128364847',
    cae: '74333333333337', arcaEstado: 'VALIDO', canal: 'WEB', creadoPorId: admin.id,
    lineas: [
      { centroCostoId: mA.bpo.id, clienteProyectoId: mA.telecom.id, porcentaje: 70 },
      { centroCostoId: mA.sf.id, porcentaje: 20 },
      { centroCostoId: mA.adm.id, porcentaje: 10 },
    ],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'ASIENTO_MANUAL', estado: 'VALIDADO', ym: m1, dia: 5,
    categoria: mA.cat['Legales'], contraparteId: cpA['Estudio Jurídico Lex S.C.'],
    descripcion: 'Honorarios Legales (recurrente)', total: 350000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mA.adm.id, porcentaje: 100 }],
    flags: { plantillaRecurrenteId: recLegales.id },
  });
  await crearMov({
    empresaId: alfa.id, origen: 'ASIENTO_MANUAL', estado: 'VALIDADO', ym: m1, dia: 1,
    categoria: mA.cat['Sueldos'], descripcion: 'Sueldos BPO (recurrente)', total: 2500000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mA.bpo.id, porcentaje: 100 }],
    flags: { plantillaRecurrenteId: recSueldos.id },
  });
  await crearMov({
    empresaId: alfa.id, origen: 'VENTA_MANUAL', estado: 'VALIDADO', ym: m1, dia: 27,
    categoria: mA.cat['Ventas SF'], contraparteId: cpA['Retail Express S.A.'],
    descripcion: 'Servicios SF cuenta Retail', total: 2420000, neto: 2000000, iva21: 420000,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0001', numero: '00000046',
    canal: 'MANUAL', creadoPorId: admin.id,
    lineas: [{ centroCostoId: mA.sf.id, clienteProyectoId: mA.retail.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'ANULADO', ym: m1, dia: 15,
    categoria: mA.cat['Office Supplies'], contraparteId: cpA['Papelera Mitre S.A.'],
    descripcion: 'Resmas y útiles', total: 60500, neto: 50000, iva21: 10500,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0001', numero: '00000701', cuitEmisor: '27234567891',
    cae: '74444444444448', arcaEstado: 'VALIDO', canal: 'WEB', creadoPorId: operador.id,
    motivoAnulacion: 'Cargada dos veces por error: la versión correcta es la factura 0001-00000702.',
    lineas: [{ centroCostoId: mA.adm.id, porcentaje: 100 }],
  });

  // --- Alfa, current month M0 ---
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'PENDIENTE_VALIDACION', ym: m0, dia: 4,
    categoria: mA.cat['IT & COM Services'], contraparteId: cpA['TechNet Servicios S.A.'],
    descripcion: 'Comprobante de TechNet Servicios S.A.', total: 302500, neto: 250000, iva21: 52500,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0003', numero: '00004521', cuitEmisor: '20128364847',
    cae: '74123456789015', arcaEstado: 'VALIDO', canal: 'WEB', creadoPorId: operador.id,
    archivo: pdfTechnet,
    lineas: [
      { centroCostoId: mA.bpo.id, porcentaje: 70 },
      { centroCostoId: mA.sf.id, porcentaje: 20 },
      { centroCostoId: mA.adm.id, porcentaje: 10 },
    ],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'PENDIENTE_VALIDACION', ym: m0, dia: 6,
    categoria: mA.cat['Office Supplies'], contraparteId: cpA['Papelera Mitre S.A.'],
    descripcion: 'Comprobante de Papelera Mitre S.A.', total: 96800, neto: 80000, iva21: 16800,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0001', numero: '00000777', cuitEmisor: '27234567891',
    cae: '74999999999900', arcaEstado: 'INVALIDO', canal: 'EMAIL', creadoPorId: admin.id,
    archivo: pdfPapelera,
    lineas: [{ centroCostoId: mA.adm.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'COMPROBANTE', estado: 'OBSERVADO', ym: m0, dia: 2,
    categoria: mA.cat['Representación'], contraparteId: cpA['Catering Sur S.R.L.'],
    descripcion: 'Catering reunión directorio', total: 145200, neto: 120000, iva21: 25200,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0004', numero: '00000333', cuitEmisor: '30550000004',
    cae: '74555555555559', arcaEstado: 'VALIDO', canal: 'TELEGRAM', creadoPorId: operador.id,
    camposRevisar: { total: 'Confianza baja del OCR (58%)' },
    flags: { notaObservacion: '¿Es gasto de representación o consumo interno? Confirmar con dirección.' },
    lineas: [{ centroCostoId: mA.adm.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: alfa.id, origen: 'ASIENTO_MANUAL', estado: 'PENDIENTE_VALIDACION', ym: m0, dia: 1,
    categoria: mA.cat['Sueldos'], descripcion: 'Sueldos BPO (recurrente)', total: 2500000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mA.bpo.id, porcentaje: 100 }],
    flags: { plantillaRecurrenteId: recSueldos.id },
  });

  // --- Beta ---
  await crearMov({
    empresaId: beta.id, origen: 'ASIENTO_MANUAL', estado: 'VALIDADO', ym: m1, dia: 1,
    categoria: mB.cat['Sueldos'], descripcion: 'Sueldos equipo Beta', total: 1200000,
    canal: 'MANUAL', creadoPorId: admin.id, lineas: [{ centroCostoId: mB.bpo.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: beta.id, origen: 'VENTA_MANUAL', estado: 'VALIDADO', ym: m0, dia: 10,
    categoria: mB.cat['Ventas BPO'], contraparteId: cpB['Cliente Banco S.A.'],
    descripcion: 'Servicios mensuales Banco', total: 1210000, neto: 1000000, iva21: 210000,
    tipoComprobante: 'FACTURA_A', puntoVenta: '0001', numero: '00000012',
    canal: 'MANUAL', creadoPorId: admin.id,
    lineas: [{ centroCostoId: mB.bpo.id, clienteProyectoId: mB.interno.id, porcentaje: 100 }],
  });
  await crearMov({
    empresaId: beta.id, origen: 'ASIENTO_MANUAL', estado: 'PENDIENTE_VALIDACION', ym: m0, dia: 12,
    categoria: mB.cat['Impuestos'], descripcion: 'IIBB período actual', total: 180000,
    canal: 'MANUAL', creadoPorId: admin.id,
    lineas: [
      { centroCostoId: mB.bpo.id, porcentaje: 50 },
      { centroCostoId: mB.sf.id, porcentaje: 50 },
    ],
  });

  console.log('Seed aplicado ✔');
  console.log('  Usuarios: admin@demo.test / operador@demo.test (password: %s)', PASSWORD_DEMO);
  console.log('  Empresas: empresa-alfa (admin=Administrador, operador=Cargador), empresa-beta (admin=Validador)');
  console.log('  Período cerrado: %d-%d en Alfa, con un comprobante RETENIDO.', m2.anio, m2.mes);
  console.log('  PDFs de ejemplo en /storage (visor + mock OCR con marcador PNL-MOCK).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
