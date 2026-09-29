import type { Rol } from '@prisma/client';

// Reportes personalizados: reportes armados a medida, a pedido de alguien, que
// miran la información desde otra perspectiva. No los ve todo el mundo: un
// administrador los habilita por usuario y empresa desde Configuración
// (tabla ReporteHabilitado).
//
// Agregar un reporte = una entrada acá + su página en
// app/(app)/[empresaSlug]/reportes-personalizados/<id>/page.tsx, que arranca
// con requireReportePage(slug, '<id>'). El id es estable: está en la base.

export type ReportePersonalizado = {
  id: string; // slug estable: URL y columna reporteId
  titulo: string;
  descripcion: string; // 1–2 frases, se muestra en Configuración y en el índice
  rolMinimo: Rol; // sólo se puede habilitar a quien lo alcanza
  pedidoPor?: string; // quién lo pidió (texto libre)
};

export const CATALOGO: ReportePersonalizado[] = [
  {
    id: 'gasto-por-proveedor',
    titulo: 'Gasto por proveedor',
    descripcion:
      'Los 15 proveedores con más compras de los últimos 12 meses: neto, cantidad de comprobantes y peso sobre el total, con acceso a los comprobantes de cada uno.',
    rolMinimo: 'VALIDADOR',
    pedidoPor: 'Ejemplo inicial',
  },
];

export function reporteDelCatalogo(id: string): ReportePersonalizado | undefined {
  return CATALOGO.find((r) => r.id === id);
}
