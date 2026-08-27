import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

// Models that carry an `empresaId` column. Every operation on them gets the
// company filter injected (reads) or the company id forced (writes).
export const SCOPED_MODELS = new Set([
  'Categoria',
  'CentroCosto',
  'Cliente',
  'Proyecto',
  'Contraparte',
  'PlantillaDistribucion',
  'PlantillaRecurrente',
  'ReglaAsignacion',
  'Movimiento',
  'Periodo',
  'AuditLog',
  'Invitacion',
  'TelegramVinculo',
  'Empleado',
  'ReciboSueldo',
  'LoteIngesta',
  'Resumen',
]);

// Child models without empresaId: scoped through their parent relation.
const RELATION_SCOPE: Record<string, (empresaId: string) => object> = {
  MovimientoLinea: (empresaId) => ({ movimiento: { empresaId } }),
  PlantillaDistribucionLinea: (empresaId) => ({ plantilla: { empresaId } }),
  EmpleadoDistribucionLinea: (empresaId) => ({ empleado: { empresaId } }),
  ReciboDistribucionLinea: (empresaId) => ({ recibo: { empresaId } }),
  CostoManualEmpleado: (empresaId) => ({ empleado: { empresaId } }),
  PrepagaEmpleado: (empresaId) => ({ empleado: { empresaId } }),
  MovimientoEmpleado: (empresaId) => ({ movimiento: { empresaId } }),
  ResumenLinea: (empresaId) => ({ resumen: { empresaId } }),
};

const READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const WHERE_MANY_OPS = new Set(['updateMany', 'deleteMany']);
// Operations whose `where` only accepts unique fields: enforced with a pre-query guard.
const GUARDED_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

/**
 * Pure args transform: injects the empresa filter / forces empresaId on writes.
 * Exported separately so the isolation logic is unit-testable without a DB.
 */
export function applyEmpresaScope(model: string, operation: string, args: any, empresaId: string): any {
  const scopeFilter = SCOPED_MODELS.has(model)
    ? { empresaId }
    : RELATION_SCOPE[model]
      ? RELATION_SCOPE[model](empresaId)
      : null;
  if (!scopeFilter) return args;

  const a = { ...(args ?? {}) };

  if (READ_OPS.has(operation) || WHERE_MANY_OPS.has(operation)) {
    a.where = a.where ? { AND: [a.where, scopeFilter] } : scopeFilter;
    return a;
  }
  if (operation === 'create' && SCOPED_MODELS.has(model)) {
    a.data = { ...(a.data ?? {}), empresaId }; // always force the active company
    return a;
  }
  if (operation === 'createMany' && SCOPED_MODELS.has(model)) {
    const data = Array.isArray(a.data) ? a.data : [a.data];
    a.data = data.map((d: any) => ({ ...d, empresaId }));
    return a;
  }
  if (operation === 'upsert') {
    // Kept out of the scoped surface on purpose: its unique-where semantics
    // cannot be safely re-scoped. Use findFirst + create/update instead.
    throw new ForbiddenError('Operación upsert no soportada en el cliente scoped por empresa.');
  }
  return a;
}

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Returns a Prisma client hard-scoped to one company. All queries against
 * company-owned models are filtered/forced to `empresaId`; unique-where
 * operations (update/delete/findUnique) are guarded with an ownership check
 * before executing. Cross-company access throws ForbiddenError.
 */
export function scopedDb(empresaId: string) {
  return prisma.$extends({
    name: `empresa-scope`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isScoped = SCOPED_MODELS.has(model) || RELATION_SCOPE[model];
          if (!isScoped) return query(args);

          if (GUARDED_OPS.has(operation)) {
            const where = (args as any)?.where;
            const existing = await (prisma as any)[delegateName(model)].findFirst({
              where,
              select: SCOPED_MODELS.has(model)
                ? { id: true, empresaId: true }
                : { id: true },
              ...(SCOPED_MODELS.has(model) ? {} : {}),
            });
            if (existing) {
              if (SCOPED_MODELS.has(model) && existing.empresaId !== empresaId) {
                // Record exists but belongs to another company: never reveal it.
                if (operation.startsWith('findUnique')) {
                  if (operation === 'findUniqueOrThrow') {
                    throw new Prisma.PrismaClientKnownRequestError('No encontrado', {
                      code: 'P2025',
                      clientVersion: Prisma.prismaVersion.client,
                    });
                  }
                  return null;
                }
                throw new ForbiddenError('El registro pertenece a otra empresa.');
              }
              if (!SCOPED_MODELS.has(model)) {
                // Child model: verify parent ownership via relation filter.
                const guard = await (prisma as any)[delegateName(model)].findFirst({
                  where: { AND: [where, RELATION_SCOPE[model](empresaId)] },
                  select: { id: true },
                });
                if (!guard) {
                  if (operation === 'findUnique') return null;
                  throw new ForbiddenError('El registro pertenece a otra empresa.');
                }
              }
            }
            return query(args);
          }

          return query(applyEmpresaScope(model, operation, args, empresaId) as any);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
