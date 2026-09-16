import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { verificarTitular, nombreClaveEmpresa } from '@/lib/resumenes/titular';
import { ingestarResumen, procesarExtraccionResumen } from '@/lib/resumenes/ingesta';

// Un resumen subido a la empresa equivocada: la verificación busca el CUIT o
// la razón social de la empresa en el texto del PDF y en el titular que
// declara la extracción. NO_COINCIDE bloquea la conciliación (ver
// resumen-vinculos.test.ts); SIN_DATOS (escaneo sin titular) no bloquea.

const ewwo = { razonSocial: 'Ewwo Consulting S.R.L.', cuit: '30712093486' };

describe('nombreClaveEmpresa', () => {
  it('quita la forma jurídica y normaliza', () => {
    expect(nombreClaveEmpresa('Ewwo Consulting S.R.L.')).toBe('ewwo consulting');
    expect(nombreClaveEmpresa('Kawellu Soluciones SRL')).toBe('kawellu soluciones');
    expect(nombreClaveEmpresa('ACME Sociedad Anónima')).toBe('acme');
    expect(nombreClaveEmpresa('Árbol Rojo S.A.S.')).toBe('arbol rojo');
  });
});

describe('verificarTitular (puro)', () => {
  it('coincide por CUIT con guiones en el texto', () => {
    const r = verificarTitular({ texto: 'Cuenta corriente\nCUIT: 30-71209348-6\nSaldo', titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('COINCIDE');
  });

  it('coincide por CUIT sin guiones', () => {
    const r = verificarTitular({ texto: 'Titular 30712093486', titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('COINCIDE');
  });

  it('no confunde un CUIT parecido pegado a otros números', () => {
    const r = verificarTitular({ texto: 'Ref 9930712093486001', titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('NO_COINCIDE');
  });

  it('coincide por razón social sin la forma jurídica, sin importar mayúsculas ni puntuación', () => {
    const r = verificarTitular({ texto: 'Resumen de cuenta\nEWWO CONSULTING SRL\nCVU 000000', titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('COINCIDE');
  });

  it('coincide por el titular que declaró la extracción (escaneo sin capa de texto)', () => {
    const r = verificarTitular({ texto: null, titularCuenta: 'EWWO CONSULTING S.R.L.', cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('COINCIDE');
    const porCuit = verificarTitular({ texto: null, titularCuenta: 'Cuenta pesos', cuitTitularCuenta: '30-71209348-6', empresa: ewwo });
    expect(porCuit.resultado).toBe('COINCIDE');
  });

  it('otra empresa en el texto: NO_COINCIDE con el titular detectado', () => {
    const r = verificarTitular({
      texto: 'Mercado Pago - Cuenta en Pesos ARBOLITO ROJO S.R.L. CUIT 30-71111111-1 CVU 0000003100026324912920',
      titularCuenta: 'ARBOLITO ROJO S.R.L.',
      cuitTitularCuenta: '30-71111111-1',
      empresa: ewwo,
    });
    expect(r.resultado).toBe('NO_COINCIDE');
    expect(r.titularDetectado).toBe('ARBOLITO ROJO S.R.L. · CUIT 30-71111111-1');
  });

  it('texto con contenido pero sin la empresa y sin titular declarado: NO_COINCIDE', () => {
    const r = verificarTitular({ texto: 'Resumen de cuenta de un tercero con muchas líneas de movimientos y saldos', titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo });
    expect(r.resultado).toBe('NO_COINCIDE');
    expect(r.titularDetectado).toBeNull();
  });

  it('sin texto ni titular no hay con qué verificar: SIN_DATOS', () => {
    expect(verificarTitular({ texto: null, titularCuenta: null, cuitTitularCuenta: null, empresa: ewwo }).resultado).toBe('SIN_DATOS');
    expect(verificarTitular({ texto: '   ', titularCuenta: '', cuitTitularCuenta: null, empresa: ewwo }).resultado).toBe('SIN_DATOS');
  });

  it('una razón social demasiado corta no se busca por nombre (evita falsos positivos)', () => {
    const r = verificarTitular({ texto: 'resumen de cuenta sa de algo con movimientos', titularCuenta: null, cuitTitularCuenta: null, empresa: { razonSocial: 'S.A.', cuit: '30712093486' } });
    expect(r.resultado).toBe('NO_COINCIDE');
  });
});

/** PDF mínimo con capa de texto (una página, Helvetica): alcanza para unpdf. */
function pdfConTexto(texto: string): Buffer {
  const stream = `BT /F1 12 Tf 50 700 Td (${texto.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('verificación del titular al extraer (integración)', () => {
  const sufijo = `titular-${Date.now()}`;
  let empresaId: string;
  let usuarioId: string;

  beforeAll(async () => {
    const usuario = await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Titular', passwordHash: 'x' } });
    usuarioId = usuario.id;
    const empresa = await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Ewwo Consulting S.R.L.', cuit: '30712093486' } });
    empresaId = empresa.id;
  });

  afterAll(async () => {
    await prisma.resumenLinea.deleteMany({ where: { resumen: { empresaId } } });
    await prisma.resumen.deleteMany({ where: { empresaId } });
    await prisma.job.deleteMany({ where: { empresaId } });
    await prisma.periodo.deleteMany({ where: { empresaId } });
    await prisma.auditLog.deleteMany({ where: { empresaId } });
    await prisma.empresa.delete({ where: { id: empresaId } });
    await prisma.usuario.delete({ where: { id: usuarioId } });
  });

  const extraer = async (filename: string, buffer: Buffer) => {
    const { resumenId } = await ingestarResumen({ empresaId, usuarioId, buffer, filename, mime: 'application/pdf' });
    await procesarExtraccionResumen({ resumenId, empresaId });
    return prisma.resumen.findUniqueOrThrow({ where: { id: resumenId } });
  };

  it('el PDF menciona a la empresa: COINCIDE', async () => {
    const r = await extraer('propio.pdf', pdfConTexto(`Resumen de cuenta EWWO CONSULTING S.R.L. CUIT 30-71209348-6 ${sufijo}`));
    expect(r.verificacionTitular).toBe('COINCIDE');
  });

  it('el PDF es de otra empresa: NO_COINCIDE', async () => {
    const r = await extraer('ajeno.pdf', pdfConTexto(`Mercado Pago Cuenta en Pesos ARBOLITO ROJO S.R.L. CVU 0000003100026324912920 ${sufijo}`));
    expect(r.verificacionTitular).toBe('NO_COINCIDE');
  });

  it('sin capa de texto ni titular declarado: SIN_DATOS (no bloquea)', async () => {
    const r = await extraer('escaneo.pdf', Buffer.from(`%PDF-1.4 escaneo ${sufijo}`));
    expect(r.verificacionTitular).toBe('SIN_DATOS');
  });
});
