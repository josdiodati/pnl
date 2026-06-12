import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ModuloFuturo } from '@/components/modulo-futuro';

export default async function ReportesPage({ params }: { params: { empresaSlug: string } }) {
  await requireEmpresaPage(params.empresaSlug);
  return (
    <ModuloFuturo
      empresaSlug={params.empresaSlug}
      icono="reporte"
      titulo="Reportes P&L"
      resumen="El estado de resultados formateado sobre la data ya validada: la vista que hoy resuelve la planilla, pero generada en vivo desde los movimientos. Mientras tanto, la pestaña Movimientos ofrece filtros, totales por selección, desglose por centro de costo y export CSV."
      incluira={[
        'P&L mensual y acumulado del ejercicio fiscal (julio–junio), comparativo contra meses anteriores.',
        'Apertura por centro de costo (BPO / SF / Administración) y por cliente/proyecto.',
        'Drill-down: de cada número del reporte al listado de movimientos que lo componen, y de ahí al comprobante original.',
        'Comparativos entre empresas del grupo y export a Excel.',
      ]}
      modeloListo="todo movimiento validado ya guarda categoría, doble dimensión de asignación porcentual y período de devengamiento — el reporte es una capa de lectura, sin migraciones."
    />
  );
}
