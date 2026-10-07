'use client';

import { useState } from 'react';

// Tipo de cambio para imputar una línea de resumen sin pesificar (consumo en
// moneda extranjera, `linea.monto` null). El servidor hace la cuenta (importe
// original × TC); acá se muestra en vivo cuántos pesos va a dar.
export function TipoCambioInput({
  montoOrigen,
  moneda,
  compacto = false,
}: {
  montoOrigen: number | null;
  moneda: string;
  compacto?: boolean;
}) {
  const [valor, setValor] = useState('');
  const t = valor.trim();
  const tc = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  const origen = montoOrigen != null ? Math.abs(montoOrigen) : null;
  const pesos = origen != null && t !== '' && Number.isFinite(tc) && tc > 0 ? Math.round(origen * tc * 100) / 100 : null;
  const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      {!compacto && <label className="label">Tipo de cambio ($ por {moneda})</label>}
      <input
        name="tipoCambio"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className={`input text-right tabular-nums ${compacto ? 'text-xs w-full' : ''}`}
        inputMode="decimal"
        placeholder={compacto ? `TC ($ por ${moneda})` : '0,00'}
        required
      />
      {origen != null && (
        <p className="text-[11px] text-slate-500 mt-0.5">
          {moneda} {fmt(origen)}
          {pesos != null && <> × {fmt(tc)} = <strong>$ {fmt(pesos)}</strong></>}
        </p>
      )}
    </div>
  );
}
