import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { esViolacionUnicidad } from '@/lib/errors';

// Un P2002 (índice único, p.ej. nombre duplicado de proyecto) tiene que poder
// mapearse a un mensaje de formulario en vez de explotar como error genérico.
describe('esViolacionUnicidad', () => {
  it('detecta el P2002 de Prisma', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });
    expect(esViolacionUnicidad(err)).toBe(true);
  });

  it('no confunde otros errores conocidos de Prisma', () => {
    const err = new Prisma.PrismaClientKnownRequestError('No encontrado', {
      code: 'P2025',
      clientVersion: Prisma.prismaVersion.client,
    });
    expect(esViolacionUnicidad(err)).toBe(false);
  });

  it('no confunde errores comunes', () => {
    expect(esViolacionUnicidad(new Error('cualquiera'))).toBe(false);
    expect(esViolacionUnicidad(null)).toBe(false);
  });
});
