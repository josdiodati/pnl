'use client';

import { useState } from 'react';
import {
  esRepartoPorMonto,
  montosDesdePorcentajes,
  porcentajesDesdeMontos,
  redondearPorcentajes,
  sumaCien,
} from '@/lib/movimientos/distribucion';

// Reusable editor for percentage splits (doc 06): N rows of
// cost center (required) + client/project (optional) + percentage.
// Shows the live amount per row and how much is missing to reach 100%.
// Inputs are named linea_centroCostoId / linea_clienteId /
// linea_porcentaje so plain server actions can read them as parallel arrays.
// With `neto`, the split can also be loaded by amount ("Monto neto"): the
// user types each line's neto and the hidden percentage is derived with 10
// decimals, so the amounts come back to the cent on the comprobante's neto.

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

type Modo = 'porcentaje' | 'monto';

/** Importe tipeado: acepta "1.234.567,89", "1234567,89" o "1234567.89". */
function parseMonto(valor: string): number | null {
  let t = valor.trim().replace(/\$|\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const aCentavos = (pesos: number) => Math.round(pesos * 100);
const pctNum = (p: string) => Number(p.replace(',', '.')) || 0;

export function DistribucionEditor({
  centros,
  clientes,
  proyectos,
  plantillas = [],
  inicial,
  totalFirmado,
  neto,
}: {
  centros: OpcionId[];
  clientes: OpcionCliente[];
  proyectos: OpcionProyecto[];
  plantillas?: PlantillaOpcion[];
  inicial?: LineaEditor[];
  /** Signed total in pesos; when present, each row shows its derived amount live. */
  totalFirmado?: number | null;
  /** Neto del comprobante (sin signo, en su moneda): habilita repartir por monto. */
  neto?: { importe: number; moneda: string } | null;
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
  const netoCentavos = neto && neto.importe > 0 ? aCentavos(neto.importe) : null;
  const montoHabilitado = netoCentavos != null;
  // Un reparto guardado por monto (más de 4 decimales) se reabre por monto.
  const [modo, setModo] = useState<Modo>(() =>
    montoHabilitado && inicial?.length && esRepartoPorMonto(inicial.map((l) => pctNum(l.porcentaje))) ? 'monto' : 'porcentaje',
  );
  const formatearMontos = (pcts: number[]) =>
    montosDesdePorcentajes(pcts, netoCentavos ?? 0).map((c) => moneyFmt.format(c / 100));
  const [montos, setMontos] = useState<string[]>(() =>
    modo === 'monto' ? formatearMontos(lineas.map((l) => pctNum(l.porcentaje))) : [],
  );
  const porMonto = modo === 'monto' && montoHabilitado;

  // Por monto, el % de cada línea se deriva de los montos sobre el neto.
  const montosCentavos = lineas.map((_, i) => {
    const m = parseMonto(montos[i] ?? '');
    return m == null ? 0 : aCentavos(m);
  });
  const pctsDerivados = porMonto ? porcentajesDesdeMontos(montosCentavos, netoCentavos!) : [];
  const sumaMontos = montosCentavos.reduce((a, b) => a + b, 0);

  const suma = lineas.reduce((acc, l) => acc + pctNum(l.porcentaje), 0);
  const sumaRedondeada = Math.round(suma * 10000) / 10000;
  const completo = porMonto ? sumaMontos === netoCentavos && sumaCien(pctsDerivados) : sumaRedondeada === 100;

  function cambiarModo(nuevo: Modo) {
    if (nuevo === modo) return;
    if (nuevo === 'monto') {
      setMontos(formatearMontos(lineas.map((l) => pctNum(l.porcentaje))));
    } else {
      // Vuelta a %: los derivados, legibles (4 decimales) si cierran 100.
      const pcts = sumaCien(pctsDerivados) ? redondearPorcentajes(pctsDerivados, 4) : pctsDerivados;
      setLineas((prev) => prev.map((l, i) => ({ ...l, porcentaje: String(pcts[i] ?? '') })));
    }
    setModo(nuevo);
  }

  function actualizarMonto(i: number, valor: string) {
    setMontos((prev) => lineas.map((_, j) => (j === i ? valor : prev[j] ?? '')));
  }

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
    // Por monto, la línea nueva propone lo que falta para llegar al neto.
    if (porMonto) {
      const falta = netoCentavos! - sumaMontos;
      setMontos((prev) => [...lineas.map((_, j) => prev[j] ?? ''), falta > 0 ? moneyFmt.format(falta / 100) : '']);
    }
  }

  function quitar(i: number) {
    if (lineas.length <= 1) return;
    setLineas((prev) => prev.filter((_, j) => j !== i));
    setMontos((prev) => prev.filter((_, j) => j !== i));
  }

  function partesIguales() {
    if (porMonto) {
      const n = lineas.length;
      const base = Math.floor(1000000 / n);
      setMontos(formatearMontos(lineas.map((_, i) => (base + (i === n - 1 ? 1000000 - base * n : 0)) / 10000)));
      return;
    }
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
    if (porMonto) setMontos(formatearMontos(p.lineas.map((l) => l.porcentaje)));
  }

  const simbolo = neto && neto.moneda !== 'ARS' ? neto.moneda : '$';
  const faltaMonto = porMonto ? netoCentavos! - sumaMontos : 0;

  // Importe en vivo de cada fila: sobre el neto si se conoce (es la base que
  // reparte el P&L), si no sobre el total firmado.
  function importeFila(l: LineaEditor): string {
    const pct = pctNum(l.porcentaje);
    if (netoCentavos != null) return `neto ${simbolo} ${moneyFmt.format(Math.round(netoCentavos * pct) / 10000)}`;
    if (totalFirmado == null) return '';
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
        {montoHabilitado && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs">
            <span className="text-slate-500">Repartir por</span>
            {(['porcentaje', 'monto'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => cambiarModo(m)}
                className={`rounded px-2 py-0.5 border ${modo === m ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 text-slate-600'}`}
              >
                {m === 'porcentaje' ? '%' : 'Monto neto'}
              </button>
            ))}
          </span>
        )}
      </div>
      {porMonto && (
        <p className="text-[11px] text-slate-500">
          Cargá el neto (sin IVA ni percepciones) de cada línea; el % se calcula solo. Neto del comprobante:{' '}
          <strong className="tabular-nums">{simbolo} {moneyFmt.format(netoCentavos! / 100)}</strong>.
        </p>
      )}

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
          {porMonto ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">{simbolo}</span>
              <input
                value={montos[i] ?? ''}
                onChange={(e) => actualizarMonto(i, e.target.value)}
                className="input !w-36 text-right tabular-nums"
                inputMode="decimal"
                placeholder="Monto neto"
                required
              />
              <input type="hidden" name="linea_porcentaje" value={String(pctsDerivados[i] ?? 0)} />
              <span className="text-xs tabular-nums text-slate-500 w-20 text-right">
                {(pctsDerivados[i] ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 4 })}%
              </span>
            </div>
          ) : (
            <>
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
              {(totalFirmado != null || netoCentavos != null) && (
                <span className="text-xs tabular-nums text-slate-500 w-36 text-right">{importeFila(l)}</span>
              )}
            </>
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
          {porMonto
            ? completo
              ? `Suma el neto ${simbolo} ${moneyFmt.format(netoCentavos! / 100)} ✓`
              : `Suma ${simbolo} ${moneyFmt.format(sumaMontos / 100)} — ${faltaMonto > 0 ? 'faltan' : 'sobran'} ${simbolo} ${moneyFmt.format(Math.abs(faltaMonto) / 100)}`
            : completo
            ? 'Suma 100% ✓'
            : `Suma ${sumaRedondeada.toLocaleString('es-AR')}% — ${sumaRedondeada < 100 ? 'faltan' : 'sobran'} ${Math.abs(Math.round((100 - sumaRedondeada) * 10000) / 10000).toLocaleString('es-AR')}%`}
        </span>
      </div>
    </div>
  );
}
