import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getFileStorage } from '@/lib/storage';
import { purgarNoComprobantes } from '@/lib/carga/purga';

// Los NO_COMPROBANTE se borran solos a los 7 días: movimiento y archivo, con
// auditoría. Nada más se toca.

const sufijo = `purga-${Date.now()}`;
let empresaId = '';
let usuarioId = '';
const DIA = 86_400_000;

async function documento(estado: 'NO_COMPROBANTE' | 'PENDIENTE_VALIDACION', diasAtras: number, nombre: string) {
  const { key } = await getFileStorage().put(Buffer.from(`%PDF ${sufijo} ${nombre}`), { filename: nombre, mime: 'application/pdf', empresaId });
  const lote = await prisma.loteIngesta.create({ data: { empresaId, canal: 'EMAIL', creadoPorId: usuarioId, archivos: 1 } });
  const m = await prisma.movimiento.create({
    data: {
      empresaId, origen: 'COMPROBANTE', creadoPorId: usuarioId, estado, archivoKey: key, archivoNombre: nombre, loteId: lote.id,
      flags: { tipoDocumento: 'PUBLICIDAD' },
    },
  });
  // updatedAt es @updatedAt: se retrocede por SQL.
  await prisma.$executeRaw`UPDATE "Movimiento" SET "updatedAt" = ${new Date(Date.now() - diasAtras * DIA)} WHERE id = ${m.id}`;
  return { id: m.id, key, loteId: lote.id };
}

beforeAll(async () => {
  usuarioId = (await prisma.usuario.create({ data: { email: `${sufijo}@test.local`, nombre: 'Test Purga', passwordHash: 'x' } })).id;
  empresaId = (await prisma.empresa.create({ data: { slug: sufijo, razonSocial: 'Purga SA', cuit: '30714325651' } })).id;
});
afterAll(async () => {
  await prisma.movimiento.deleteMany({ where: { empresaId } });
  await prisma.loteIngesta.deleteMany({ where: { empresaId } });
  await prisma.auditLog.deleteMany({ where: { empresaId } });
  await prisma.empresa.delete({ where: { id: empresaId } });
  await prisma.usuario.delete({ where: { id: usuarioId } });
});

describe('purgarNoComprobantes', () => {
  it('borra los NO_COMPROBANTE de más de 7 días (movimiento y archivo) y deja lo demás', async () => {
    const viejo = await documento('NO_COMPROBANTE', 8, 'viejo.pdf');
    const reciente = await documento('NO_COMPROBANTE', 3, 'reciente.pdf');
    const pendiente = await documento('PENDIENTE_VALIDACION', 30, 'factura.pdf');

    const n = await purgarNoComprobantes();
    expect(n).toBeGreaterThanOrEqual(1);

    expect(await prisma.movimiento.findUnique({ where: { id: viejo.id } })).toBeNull();
    expect(await getFileStorage().exists(viejo.key)).toBe(false);
    expect((await prisma.loteIngesta.findUniqueOrThrow({ where: { id: viejo.loteId } })).archivos).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { empresaId, entidadId: viejo.id, accion: 'PURGAR_NO_COMPROBANTE' } });
    expect(audit?.antes).toMatchObject({ archivoNombre: 'viejo.pdf', tipoDocumento: 'PUBLICIDAD' });

    expect(await prisma.movimiento.findUnique({ where: { id: reciente.id } })).not.toBeNull();
    expect(await getFileStorage().exists(reciente.key)).toBe(true);
    expect(await prisma.movimiento.findUnique({ where: { id: pendiente.id } })).not.toBeNull();
  });
});
