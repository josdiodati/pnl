import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ModuloFuturo } from '@/components/modulo-futuro';

export default async function HeadcountPage({ params }: { params: { empresaSlug: string } }) {
  await requireEmpresaPage(params.empresaSlug);
  return (
    <ModuloFuturo
      empresaSlug={params.empresaSlug}
      icono="headcount"
      titulo="Headcount"
      resumen="Carga de dotación por sector y mes: el insumo que alimenta el seat cost del motor de prorrateos. Se captura una vez por mes y habilita repartir costos compartidos en proporción a los puestos reales de cada unidad."
      incluira={[
        'Grilla de dotación por sector (BPO / SF / Administración) y mes del ejercicio.',
        'Historial de evolución de headcount, con altas y bajas auditadas.',
        'Validación contra el período: la dotación de un mes cerrado queda congelada.',
        'Integración directa como driver del seat cost en el motor de prorrateos.',
      ]}
      modeloListo="los centros de costo y los períodos mensuales ya existen; headcount es una tabla nueva que referencia ambos, sin tocar lo construido."
    />
  );
}
