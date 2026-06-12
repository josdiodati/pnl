import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ModuloFuturo } from '@/components/modulo-futuro';

export default async function ProrrateosPage({ params }: { params: { empresaSlug: string } }) {
  await requireEmpresaPage(params.empresaSlug);
  return (
    <ModuloFuturo
      empresaSlug={params.empresaSlug}
      icono="prorrateo"
      titulo="Motor de prorrateos"
      resumen="La lógica más distintiva de la planilla original: distribuir automáticamente los costos de soporte sobre las unidades de negocio. Corre sobre data ya capturada y validada, por eso es la etapa que sigue a la captura."
      incluira={[
        'Seat cost: costo por puesto calculado desde el headcount de cada sector/mes.',
        'OH Burden y Admin Burden: reparto de los costos de Administración sobre BPO y SF según reglas configurables.',
        'Descuentos y cruces entre unidades de negocio.',
        'Las asignaciones generadas conviven con las manuales y se pueden regenerar al cambiar una regla, sin tocar lo cargado.',
      ]}
      modeloListo="cada línea de asignación ya distingue su origen (MANUAL vs PRORRATEO), así las corridas del motor se identifican, auditan y regeneran sin migrar datos."
    />
  );
}
