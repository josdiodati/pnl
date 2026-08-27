// Sección opt-in al pie de los formularios que asignan (cola de Asignación y
// atajo validar+asignar de Validación): convierte la imputación que se está
// cargando en una regla, para que el próximo comprobante del mismo emisor se
// impute solo.
//
// Sin JS: es marcado plano dentro del <form> que ya existe. Si el checkbox
// queda sin marcar, la action ignora el resto de los campos.
//
// El conflicto con una regla previa se resuelve acá y no después del submit
// porque depende solo del CUIT, que ya se conoce al renderizar.

import { OcrPopup } from './ocr-popup';
import type { OcrParaRegla } from '@/lib/reglas/ocr-para-regla';

export type ReglaExistente = {
  nombre: string;
  imputacion: string;
};

export function ReglaDesdeAsignacion({
  cuit,
  razonSocial,
  existente,
  ocr,
}: {
  cuit: string | null;
  razonSocial: string | null;
  existente: ReglaExistente | null;
  /** Lo que leyó el OCR, para elegir la palabra clave desde un pop-up. */
  ocr?: OcrParaRegla | null;
}) {
  // Sin CUIT no hay condición que construir: la regla matchearía cualquier cosa.
  if (!cuit) return null;

  return (
    <fieldset className="rounded-md border border-slate-200 p-3 space-y-2">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="crearRegla" value="1" className="mt-0.5" />
        <span>
          {existente ? 'Actualizar la regla de este emisor' : 'Crear regla para la próxima vez'}
          <span className="block text-xs font-normal text-slate-500">
            Se aplicará a los comprobantes de {razonSocial ?? 'este emisor'} (CUIT {cuit}).
          </span>
        </span>
      </label>

      {existente && (
        <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-900">
          Ya hay una regla para este CUIT: «{existente.nombre}» → {existente.imputacion}. Si marcás la
          casilla, se reemplaza por la imputación que estás cargando.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor="reglaPalabraClave">…y además diga (opcional)</label>
            {ocr && <OcrPopup ocr={ocr} />}
          </div>
          <input
            id="reglaPalabraClave"
            name="reglaPalabraClave"
            className="input w-full text-xs"
            placeholder="ej. roaming"
          />
          <p className="text-[11px] text-slate-400 mt-0.5">
            Acota la regla a los comprobantes de este emisor que mencionen ese texto.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="reglaNombre">Nombre de la regla</label>
          <input
            id="reglaNombre"
            name="reglaNombre"
            defaultValue={existente?.nombre ?? ''}
            className="input w-full text-xs"
            placeholder={`${razonSocial ?? cuit} → (categoría elegida)`}
          />
        </div>
      </div>
    </fieldset>
  );
}
