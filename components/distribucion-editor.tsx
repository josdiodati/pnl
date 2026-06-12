'use client';

import { useState } from 'react';

// Reusable editor for percentage splits (doc 06): N rows of
// cost center (required) + client/project (optional) + percentage.
// Shows the live amount per row and how much is missing to reach 100%.
// Inputs are named linea_centroCostoId / linea_clienteProyectoId /
// linea_porcentaje so plain server actions can read them as parallel arrays.

export type OpcionId = { id: string; nombre: string };
export type LineaEditor = { centroCostoId: string; clienteProyectoId: string; porcentaje: string };
export type PlantillaOpcion = {
  id: string;
  nombre: string;
  lineas: { centroCostoId: string; clienteProyectoId: string | null; porcentaje: number }[];
};

const moneyFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DistribucionEditor({
  centros,
  clientes,
  plantillas = [],
  inicial,
  totalFirmado,
}: {
  centros: OpcionId[];
  clientes: OpcionId[];
  plantillas?: PlantillaOpcion[];
  inicial?: LineaEditor[];
  /** Signed total in pesos; when present, each row shows its derived amount live. */
  totalFirmado?: number | null;
}) {
  const filaVacia = (): LineaEditor => ({
    centroCostoId: centros[0]?.id ?? '',
    clienteProyectoId: '',
    porcentaje: '100',
  });
  const [lineas, setLineas] = useState<LineaEditor[]>(
    inicial && inicial.length ? inicial : [filaVacia()],
  );

  const suma = lineas.reduce((acc, l) => acc + (Number(l.porcentaje.replace(',', '.')) || 0), 0);
  const sumaRedondeada = Math.round(suma * 10000) / 10000;
  const completo = sumaRedondeada === 100;

  function actualizar(i: number, campo: keyof LineaEditor, valor: string) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  }

  function dividir() {
    setLineas((prev) => [...prev, { ...filaVacia(), porcentaje: '' }]);
  }

  function quitar(i: number) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  }

  function partesIguales() {
    setLineas((prev) => {
      const n = prev.length;
      const base = Math.floor(1000000 / n);
      return prev.map((l, i) => ({
        ...l,
        porcentaje: String((base + (i === n - 1 ? 1000000 - base * n : 0)) / 10000),
      }));
    });
  }

  function aplicarPlantilla(id: string) {
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    setLineas(
      p.lineas.map((l) => ({
        centroCostoId: l.centroCostoId,
        clienteProyectoId: l.clienteProyectoId ?? '',
        porcentaje: String(l.porcentaje),
      })),
    );
  }

  function importeFila(l: LineaEditor): string {
    if (totalFirmado == null) return '';
    const pct = Number(l.porcentaje.replace(',', '.')) || 0;
    return `$ ${moneyFmt.format(Math.round(totalFirmado * pct) / 100)}`;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-slate-600">Asignación (centro de costo + cliente/proyecto)</span>
        {plantillas.length > 0 && (
          <select
            className="input !w-auto text-xs"
            defaultValue=""
            onChange={(e) => {
              aplicarPlantilla(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>Aplicar plantilla…</option>
            {plantillas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        )}
        <button type="button" onClick={partesIguales} className="text-xs underline text-slate-500">
          repartir en partes iguales
        </button>
      </div>

      {lineas.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            name="linea_centroCostoId"
            value={l.centroCostoId}
            onChange={(e) => actualizar(i, 'centroCostoId', e.target.value)}
            className="input !w-44"
            required
          >
            <option value="" disabled>Centro de costo…</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select
            name="linea_clienteProyectoId"
            value={l.clienteProyectoId}
            onChange={(e) => actualizar(i, 'clienteProyectoId', e.target.value)}
            className="input !w-44"
          >
            <option value="">Sin cliente/proyecto</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              name="linea_porcentaje"
              value={l.porcentaje}
              onChange={(e) => actualizar(i, 'porcentaje', e.target.value)}
              className="input !w-24 text-right tabular-nums"
              inputMode="decimal"
              placeholder="%"
              required
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          {totalFirmado != null && (
            <span className="text-xs tabular-nums text-slate-500 w-28 text-right">{importeFila(l)}</span>
          )}
          {lineas.length > 1 && (
            <button type="button" onClick={() => quitar(i)} className="text-xs text-red-500 underline">
              quitar
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button type="button" onClick={dividir} className="btn-secondary text-xs">+ Dividir</button>
        <span className={`text-xs font-medium tabular-nums ${completo ? 'text-emerald-600' : 'text-amber-600'}`}>
          {completo
            ? 'Suma 100% ✓'
            : `Suma ${sumaRedondeada.toLocaleString('es-AR')}% — ${sumaRedondeada < 100 ? 'faltan' : 'sobran'} ${Math.abs(Math.round((100 - sumaRedondeada) * 10000) / 10000).toLocaleString('es-AR')}%`}
        </span>
      </div>
    </div>
  );
}
