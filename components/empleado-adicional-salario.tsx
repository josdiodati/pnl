'use client';

import { useEffect, useState } from 'react';

// En Asignar: si la categoría elegida es "Adicionales Salarios", aparece el
// selector de empleado. Al asignar se vincula el comprobante a ese empleado
// (monto editable, por defecto el neto gravado; período = el del comprobante)
// y, si se guarda la regla, la regla recuerda el empleado. Escucha el <select>
// de categoría del form (id `selectId`) sin reescribir el form como cliente.
export function EmpleadoAdicionalSalario({
  selectId,
  categoriasIds,
  empleados,
  empleadoInicial,
  montoInicial,
  periodo,
}: {
  selectId: string;
  categoriasIds: string[];
  empleados: { id: string; nombre: string }[];
  empleadoInicial: string | null;
  montoInicial: string;
  periodo: string | null;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    const actualizar = () => setVisible(categoriasIds.includes(select.value));
    actualizar();
    select.addEventListener('change', actualizar);
    return () => select.removeEventListener('change', actualizar);
  }, [selectId, categoriasIds]);

  if (!visible) return null;
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50 p-3 space-y-2">
      <p className="text-sm font-medium text-violet-900">Adicional de salario: ¿a qué empleado corresponde?</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grow min-w-48">
          <label className="label" htmlFor="empleadoId">Empleado</label>
          <select id="empleadoId" name="empleadoId" defaultValue={empleadoInicial ?? ''} className="input w-full text-sm">
            <option value="">— Sin vincular a un empleado —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" title="El período es siempre el del comprobante">Período</label>
          <div className="input text-sm w-32 bg-white/60 text-slate-600">{periodo ?? '—'}</div>
        </div>
        <div>
          <label className="label" htmlFor="montoEmpleado" title="Por defecto, el neto gravado (sin IVA ni percepciones)">Monto ($)</label>
          <input id="montoEmpleado" name="montoEmpleado" defaultValue={montoInicial} className="input text-sm w-36 tabular-nums" />
        </div>
      </div>
      <p className="text-xs text-violet-800">
        Computa como costo de ese empleado (con su asignación) y se descuenta del gasto general. Si guardás la regla, los próximos comprobantes que asigne se vinculan solos a este empleado por su neto gravado.
      </p>
    </div>
  );
}
