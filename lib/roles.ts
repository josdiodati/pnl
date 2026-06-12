import type { Rol } from '@prisma/client';

// Role hierarchy: each level includes every permission of the previous one.
const RANGO: Record<Rol, number> = {
  CARGADOR: 1,
  VALIDADOR: 2,
  ADMINISTRADOR: 3,
};

export function rolAlcanza(rol: Rol, minimo: Rol): boolean {
  return RANGO[rol] >= RANGO[minimo];
}

export const ROL_LABEL: Record<Rol, string> = {
  CARGADOR: 'Cargador',
  VALIDADOR: 'Validador',
  ADMINISTRADOR: 'Administrador',
};
