// Sección opt-in al pie de los formularios que asignan (cola de Asignación y
// atajo validar+asignar de Validación): convierte la imputación que se está
// cargando en una regla, para que el próximo comprobante del mismo emisor se
// impute solo.
//
// Sin JS: es marcado plano dentro del <form> que ya existe. Si el checkbox
// queda sin marcar, la action ignora el resto de los campos.
//
// El conflicto con una regla previa se resuelve acá y no después del submit
// porque depende solo del CUIT, que ya se conoce al renderizar. Sin CUIT la
// regla se define por palabra clave (que se tipea recién acá), así que el
// conflicto con otra regla de la misma palabra clave se resuelve al guardar.

import { OcrPopup } from './ocr-popup';
import type { OcrParaRegla } from '@/lib/reglas/ocr-para-regla';
import { CANALES_REGLA, CANAL_LABEL } from '@/lib/reglas/desde-asignacion';

export type ReglaExistente = {
  nombre: string;
  imputacion: string;
};

export function ReglaDesdeAsignacion({
  cuit,
  razonSocial,
  existente,
  ocr,
  canal,
  cargadoPorId,
  miembros,
}: {
  cuit: string | null;
  razonSocial: string | null;
  existente: ReglaExistente | null;
  /** Lo que leyó el OCR, para elegir la palabra clave desde un pop-up. */
  ocr?: OcrParaRegla | null;
  /** Fuente y usuario de ESTE comprobante (se marcan en los selectores) y
   *  los miembros de la empresa elegibles. Por defecto: cualquiera. */
  canal?: string | null;
  cargadoPorId?: string | null;
  miembros?: { id: string; nombre: string }[];
}) {
  return (
    <fieldset className="rounded-md border border-slate-200 p-3 space-y-2">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="crearRegla" value="1" className="mt-0.5" />
        <span>
          {existente ? 'Actualizar la regla de este emisor' : 'Crear regla para la próxima vez'}
          <span className="block text-xs font-normal text-slate-500">
            {cuit
              ? `Se aplicará a los comprobantes de ${razonSocial ?? 'este emisor'} (CUIT ${cuit}).`
              : 'Este comprobante no tiene CUIT: la regla se define por la palabra clave (obligatoria), y se aplicará a los comprobantes que la mencionen.'}
          </span>
        </span>
      </label>

      {existente && (
        <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-900">
          Ya hay una regla para este CUIT: «{existente.nombre}» → {existente.imputacion}. Si marcás la
          casilla, se reemplaza por la imputación que estás cargando (salvo que la acotes por fuente o
          usuario: en ese caso se crea una regla más específica que se evalúa antes).
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor="reglaPalabraClave">{cuit ? '…y además diga (opcional)' : 'Palabra clave (obligatoria)'}</label>
            {ocr && <OcrPopup ocr={ocr} />}
          </div>
          <input
            id="reglaPalabraClave"
            name="reglaPalabraClave"
            className="input w-full text-xs"
            placeholder="ej. roaming"
          />
          <p className="text-[11px] text-slate-400 mt-0.5">
            {cuit
              ? 'Acota la regla a los comprobantes de este emisor que mencionen ese texto.'
              : 'La regla matcheará los comprobantes cuya descripción o razón social mencione ese texto.'}
          </p>
        </div>
        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="reglaCanal">Sólo si entra por</label>
            <select id="reglaCanal" name="reglaCanal" className="input w-full text-xs" defaultValue="">
              <option value="">— cualquier fuente —</option>
              {CANALES_REGLA.map((c) => (
                <option key={c} value={c}>
                  {CANAL_LABEL[c]}{c === canal ? ' (este comprobante)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reglaCargadoPorId">Sólo si lo carga</label>
            <select id="reglaCargadoPorId" name="reglaCargadoPorId" className="input w-full text-xs" defaultValue="">
              <option value="">— cualquier usuario —</option>
              {(miembros ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}{m.id === cargadoPorId ? ' (este comprobante)' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="sm:col-span-2 text-[11px] text-slate-400 -mt-1">
            Condiciones extra opcionales: con «cualquiera» la regla no las evalúa.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="reglaNombre">Nombre de la regla</label>
          <input
            id="reglaNombre"
            name="reglaNombre"
            defaultValue={existente?.nombre ?? ''}
            className="input w-full text-xs"
            placeholder={`${razonSocial ?? cuit ?? 'palabra clave'} → (categoría elegida)`}
          />
        </div>
      </div>
    </fieldset>
  );
}
