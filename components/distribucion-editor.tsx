'use client';

import { useState } from 'react';

// Reusable editor for percentage splits (doc 06): N rows of
// cost center (required) + client/project (optional) + percentage.
// Shows the live amount per row and how much is missing to reach 100%.
// Inputs are named linea_centroCostoId / linea_clienteId /
// linea_porcentaje so plain server actions can read them as parallel arrays.

export type OpcionId = { id: string; nombre: string };
// Árbol de asignación: cliente clasificado bajo un centro, proyecto bajo un
// cliente. Sin clasificar (null/undefined) = disponible en cualquier rama.
export type OpcionCliente = OpcionId & { centroCostoId?: string | null };
export type OpcionProyecto = OpcionId & { clienteId?: string | null };
export type LineaEditor = { centroCostoId: string; clienteId: string; proyectoId: string; porcentaje: string };
export type PlantillaOpcion = {
  id: string;
  nombre: string;
  lineas: { centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: number }[];
};

const moneyFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DistribucionEditor({
  centros,
  clientes,
  proyectos,
  plantillas = [],
  inicial,
  totalFirmado,
}: {
  centros: OpcionId[];
  clientes: OpcionCliente[];
  proyectos: OpcionProyecto[];
  plantillas?: PlantillaOpcion[];
  inicial?: LineaEditor[];
  /** Signed total in pesos; when present, each row shows its derived amount live. */
  totalFirmado?: number | null;
}) {
  const filaVacia = (): LineaEditor => ({
    centroCostoId: centros[0]?.id ?? '',
    clienteId: '',
    proyectoId: '',
    porcentaje: '100',
  });
  const [lineas, setLineas] = useState<LineaEditor[]>(
    inicial && inicial.length ? inicial : [filaVacia()],
  );

  const suma = lineas.reduce((acc, l) => acc + (Number(l.porcentaje.replace(',', '.')) || 0), 0);
  const sumaRedondeada = Math.round(suma * 10000) / 10000;
  const completo = sumaRedondeada === 100;

  // Opciones válidas por fila según el árbol (los sin clasificar valen siempre).
  const clientesDe = (centroCostoId: string) =>
    clientes.filter((c) => !c.centroCostoId || c.centroCostoId === centroCostoId);
  const proyectosDe = (clienteId: string) =>
    proyectos.filter((p) => !p.clienteId || (clienteId !== '' && p.clienteId === clienteId));

  function actualizar(i: number, campo: keyof LineaEditor, valor: string) {
    setLineas((prev) =>
      prev.map((l, j) => {
        if (j !== i) return l;
        const nueva = { ...l, [campo]: valor };
        // Cascada: al cambiar el centro se limpia un cliente que ya no
        // corresponde (y eso arrastra al proyecto); ídem cliente→proyecto.
        if (campo === 'centroCostoId' && nueva.clienteId) {
          const cli = clientes.find((c) => c.id === nueva.clienteId);
          if (cli?.centroCostoId && cli.centroCostoId !== valor) nueva.clienteId = '';
        }
        if ((campo === 'centroCostoId' || campo === 'clienteId') && nueva.proyectoId) {
          const pr = proyectos.find((p) => p.id === nueva.proyectoId);
          if (pr?.clienteId && pr.clienteId !== nueva.clienteId) nueva.proyectoId = '';
        }
        return nueva;
      }),
    );
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
        clienteId: l.clienteId ?? '',
        proyectoId: l.proyectoId ?? '',
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
        <span className="text-xs font-medium text-slate-600">Asignación (centro de costo + cliente + proyecto)</span>
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
            name="linea_clienteId"
            value={l.clienteId}
            onChange={(e) => actualizar(i, 'clienteId', e.target.value)}
            className="input !w-44"
          >
            <option value="">Sin cliente</option>
            {clientesDe(l.centroCostoId).map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select
            name="linea_proyectoId"
            value={l.proyectoId}
            onChange={(e) => actualizar(i, 'proyectoId', e.target.value)}
            className="input !w-44"
          >
            <option value="">Sin proyecto</option>
            {proyectosDe(l.clienteId).map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
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
