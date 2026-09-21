// Contrapartes externas (proveedores extranjeros / no fiscales, sin CUIT).
//
// Se identifican con un código sintético EXT- aleatorio, así que dos altas del
// mismo proveedor nunca comparten CUIT y la unicidad (empresaId, cuit) no las
// frena. La única forma de no duplicarlas es reconocerlas por nombre entre las
// EXT- que ya existen. Nunca se reutiliza una contraparte con CUIT real: ahí la
// identidad la fija el CUIT, no el nombre.

import { esIdentificadorExterno } from '@/lib/checks/cuit';
import { claveNombre } from './alta-automatica';

export function buscarExternaPorNombre<T extends { cuit: string; razonSocial: string }>(
  razonSocial: string,
  existentes: readonly T[],
): T | null {
  const clave = claveNombre(razonSocial);
  if (!clave) return null;
  return existentes.find((c) => esIdentificadorExterno(c.cuit) && claveNombre(c.razonSocial) === clave) ?? null;
}
