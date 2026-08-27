'use client';

import { useState } from 'react';

// Input de monto en pesos para imputar una línea de resumen sin pesificar
// (consumo en moneda extranjera, `linea.monto` null). Muestra en vivo el TC
// implícito (monto ingresado / montoOrigen) para que el validador pueda
// chequearlo contra la cotización real antes de guardar.
export function MontoArsHint({ montoOrigen, moneda }: { montoOrigen: number | null; moneda: string }) {
  const [valor, setValor] = useState('');
  const num = Number(valor.replace(',', '.'));
  const tc = montoOrigen && Number.isFinite(num) && num > 0 ? num / Math.abs(montoOrigen) : null;

  return (
    <div>
      <label className="label">Monto en pesos (a imputar)</label>
      <input
        name="montoArs"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="input text-right tabular-nums"
        inputMode="decimal"
        placeholder="0,00"
        required
      />
      {montoOrigen != null && (
        <p className="text-[11px] text-slate-500 mt-0.5">
          Consumo original: {moneda} {Math.abs(montoOrigen).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          {tc != null && ` · TC implícito ${tc.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
        </p>
      )}
    </div>
  );
}
