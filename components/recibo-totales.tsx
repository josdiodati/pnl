'use client';

import { useState } from 'react';
import { verificarAritmeticaRecibo, leerTotal, type TotalesRecibo } from '@/lib/empleados/aritmetica';

// Totales editables de un recibo en revisión. Los avisos de cuenta (el neto o
// el costo total no cierran, falta un total) se recalculan mientras se edita:
// por ejemplo, una "retención" que fue devolución cierra al cargarla en
// negativo. Los avisos informativos de la extracción van fijos.

export type CampoTotal = { name: keyof TotalesRecibo; label: string; valor: number | null };

export function ReciboTotales({
  campos,
  avisosFijos,
  editable,
}: {
  campos: CampoTotal[];
  avisosFijos: Record<string, string>;
  editable: boolean;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.name, c.valor != null ? String(c.valor) : ''])),
  );
  const leer = (vals: Record<string, string>) =>
    Object.fromEntries(campos.map((c) => [c.name, leerTotal(vals[c.name] ?? '')])) as TotalesRecibo;

  const [inicialesConAviso] = useState(() => Object.keys(verificarAritmeticaRecibo(leer(valores))).length > 0);
  const deCuenta = verificarAritmeticaRecibo(leer(valores));
  const cierra = Object.keys(deCuenta).length === 0;

  return (
    <div className="card p-3 grid grid-cols-2 gap-2">
      {campos.map((c) => {
        const aviso = [avisosFijos[c.name], deCuenta[c.name]].filter(Boolean);
        return (
          <div key={c.name}>
            <label className="label" htmlFor={`total-${c.name}`}>{c.label}</label>
            <input
              id={`total-${c.name}`}
              name={c.name}
              value={valores[c.name]}
              onChange={(e) => setValores((v) => ({ ...v, [c.name]: e.target.value }))}
              disabled={!editable}
              inputMode="decimal"
              className={`input text-sm ${deCuenta[c.name] ? 'border-amber-400' : ''}`}
            />
            {aviso.map((a) => (
              <p key={a} className="text-[11px] text-amber-700 mt-0.5">{a}</p>
            ))}
          </div>
        );
      })}
      {avisosFijos.empleado && <p className="col-span-2 text-[11px] text-amber-700">{avisosFijos.empleado}</p>}
      {editable && inicialesConAviso && cierra && (
        <p className="col-span-2 text-[12px] text-emerald-700">Los totales cierran. Al confirmar se guardan estos valores.</p>
      )}
    </div>
  );
}
