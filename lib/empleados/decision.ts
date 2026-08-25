// Decisión de estado post-extracción (pura, sin DB): espeja la filosofía de
// decidirAutovalidacion de comprobantes. El caso feliz mensual es CONFIRMADO
// directo: subís el PDF y los recibos quedan listos sin tocar nada.

export type DecisionRecibo = {
  estado: 'PENDIENTE_REVISION' | 'CONFIRMADO' | 'ANULADO';
  nota: string | null;
};

export function decidirEstadoRecibo(params: {
  camposRevisar: Record<string, string>;
  tieneDistribucion: boolean;
  periodoCerrado: boolean;
  duplicado: boolean;
}): DecisionRecibo {
  if (params.duplicado) {
    return { estado: 'ANULADO', nota: 'Duplicado: ya existe un recibo de este empleado para el mismo período y tipo' };
  }
  if (params.periodoCerrado) {
    return { estado: 'PENDIENTE_REVISION', nota: 'El período del recibo está cerrado: requiere revisión manual' };
  }
  if (Object.keys(params.camposRevisar).length > 0 || !params.tieneDistribucion) {
    return { estado: 'PENDIENTE_REVISION', nota: null };
  }
  return { estado: 'CONFIRMADO', nota: null };
}
