'use client';

import { useMemo, useState } from 'react';
import { calcularReparto, sugerenciaRetencion, type ResultadoReparto } from '@/lib/cobranzas/reparto';
import { INSTRUMENTOS, INSTRUMENTO_LABEL, ES_CHEQUE } from '@/lib/cobranzas/labels';
import { parsearImporteAr, formatMoney } from '@/lib/format';
import { registrarCobroAction } from '@/app/(app)/[empresaSlug]/ventas/actions';

// Registrar un cobro: una o varias facturas (misma moneda) + uno o varios
// instrumentos. La vista previa corre el MISMO reparto que el servidor
// (lib/cobranzas/reparto), así lo que se ve es lo que se guarda.

export type FacturaForm = {
  id: string;
  etiqueta: string;
  cliente: string;
  fechaIso: string;
  saldo: number;
  moneda: string;
  tcFactura: number | null;
};

type Fila = { tipo: string; monto: string; moneda: string; fecha: string; acreditacion: string; numero: string; banco: string };

const aDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (n: number, moneda: string) => (moneda === 'ARS' ? formatMoney(n) : `${formatMoney(n).replace('$ ', '')} ${moneda}`);

export function RegistrarCobroForm({
  slug,
  facturas,
  hoyIso,
  volver,
  errorEn,
}: {
  slug: string;
  facturas: FacturaForm[];
  hoyIso: string;
  volver: string;
  errorEn: string;
}) {
  const moneda = facturas[0]?.moneda ?? 'ARS';
  const saldoTotal = facturas.reduce((s, f) => s + f.saldo, 0);
  const nuevaFila = (monto = ''): Fila => ({ tipo: 'TRANSFERENCIA', monto, moneda: 'ARS', fecha: hoyIso, acreditacion: hoyIso, numero: '', banco: '' });
  const [filas, setFilas] = useState<Fila[]>([nuevaFila(moneda === 'ARS' ? String(Math.round(saldoTotal * 100) / 100) : '')]);
  const [cotizacion, setCotizacion] = useState('');
  const [cerrarRetencion, setCerrarRetencion] = useState(true);

  const cambiar = (i: number, campo: keyof Fila, valor: string) =>
    setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, [campo]: valor, ...(campo === 'fecha' && !ES_CHEQUE.has(f.tipo) ? { acreditacion: valor } : {}) } : f)));

  const instrumentos = filas
    .map((f) => ({ ...f, montoNum: parsearImporteAr(f.monto) }))
    .filter((f) => f.montoNum != null && !Number.isNaN(f.montoNum) && f.montoNum > 0);

  // Monto de los instrumentos expresado en la moneda de las facturas (para la sugerencia de retención).
  const totalEnMoneda = instrumentos.reduce((s, f) => s + (f.moneda === moneda ? f.montoNum! : 0), 0);
  const sugerencia = moneda === 'ARS' ? sugerenciaRetencion(saldoTotal, totalEnMoneda, 'ARS') : { sugerir: false, monto: 0 };

  const preview = useMemo((): { r?: ResultadoReparto; error?: string } => {
    if (instrumentos.length === 0) return {};
    try {
      const cot = parsearImporteAr(cotizacion);
      const r = calcularReparto({
        facturas: facturas.map((f) => ({ id: f.id, fecha: aDate(f.fechaIso), saldo: f.saldo, moneda: f.moneda, tcFactura: f.tcFactura })),
        instrumentos: instrumentos.map((f) => ({
          instrumento: f.tipo, monto: f.montoNum!, moneda: f.moneda, fecha: aDate(f.fecha),
          fechaAcreditacion: aDate(ES_CHEQUE.has(f.tipo) ? f.acreditacion || f.fecha : f.fecha),
        })),
        cotizacion: cot != null && cot > 0 ? cot : null,
        cerrarDiferenciaComoRetencion: sugerencia.sugerir && cerrarRetencion,
      });
      return { r };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [JSON.stringify(filas), cotizacion, cerrarRetencion]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicadoPorFactura = new Map<string, { importe: number; dif: number }>();
  for (const ins of preview.r?.instrumentos ?? []) {
    for (const a of ins.aplicaciones) {
      const x = aplicadoPorFactura.get(a.movimientoId) ?? { importe: 0, dif: 0 };
      aplicadoPorFactura.set(a.movimientoId, { importe: x.importe + a.importe, dif: x.dif + a.diferenciaCambioArs });
    }
  }
  const hayPesosSobreExtranjera = moneda !== 'ARS' && filas.some((f) => f.moneda === 'ARS');

  return (
    <form action={registrarCobroAction} className="space-y-4">
      <input type="hidden" name="empresaSlug" value={slug} />
      <input type="hidden" name="volver" value={volver} />
      <input type="hidden" name="errorEn" value={errorEn} />
      {facturas.map((f) => <input key={f.id} type="hidden" name="ventaId" value={f.id} />)}
      {sugerencia.sugerir && cerrarRetencion && <input type="hidden" name="cerrarRetencion" value="on" />}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th className="text-right">Saldo</th><th className="text-right">Cancela</th><th className="text-right">Queda</th>{moneda !== 'ARS' && <th className="text-right">Dif. de cambio</th>}</tr>
          </thead>
          <tbody>
            {facturas.map((f) => {
              const a = aplicadoPorFactura.get(f.id);
              return (
                <tr key={f.id}>
                  <td className="font-mono text-[12.5px] whitespace-nowrap">{f.etiqueta}</td>
                  <td>{f.cliente}</td>
                  <td className="font-mono text-[12.5px]">{f.fechaIso.split('-').reverse().join('/')}</td>
                  <td className="num">{fmt(f.saldo, f.moneda)}</td>
                  <td className="num text-accent-strong">{a ? fmt(a.importe, f.moneda) : '—'}</td>
                  <td className="num">{fmt(Math.max(0, f.saldo - (a?.importe ?? 0)), f.moneda)}</td>
                  {moneda !== 'ARS' && (
                    <td className={`num ${a && a.dif < 0 ? 'text-red-700' : ''}`}>{a && Math.abs(a.dif) >= 1 ? formatMoney(a.dif) : '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-4 space-y-3">
        <p className="label !mb-0">Instrumentos</p>
        {filas.map((f, i) => {
          const cheque = ES_CHEQUE.has(f.tipo);
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[10rem_10rem_6rem_9rem_9rem_1fr_auto] items-end">
              <div>
                <label className="label">Tipo</label>
                <select name="ins_tipo" value={f.tipo} onChange={(e) => cambiar(i, 'tipo', e.target.value)} className="input text-xs">
                  {INSTRUMENTOS.map((t) => <option key={t} value={t}>{INSTRUMENTO_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Monto</label>
                <input name="ins_monto" value={f.monto} onChange={(e) => cambiar(i, 'monto', e.target.value)} className="input text-xs font-mono" inputMode="decimal" placeholder="0,00" />
              </div>
              <div>
                <label className="label">Moneda</label>
                <select name="ins_moneda" value={f.moneda} onChange={(e) => cambiar(i, 'moneda', e.target.value)} className="input text-xs">
                  <option value="ARS">ARS</option>
                  {moneda !== 'ARS' && <option value={moneda}>{moneda}</option>}
                </select>
              </div>
              <div>
                <label className="label">{cheque ? 'Recibido' : 'Fecha'}</label>
                <input type="date" name="ins_fecha" value={f.fecha} onChange={(e) => cambiar(i, 'fecha', e.target.value)} className="input text-xs" />
              </div>
              <div>
                <label className="label">{cheque ? 'Fecha de cobro' : ' '}</label>
                {cheque ? (
                  <input type="date" name="ins_acreditacion" value={f.acreditacion} onChange={(e) => cambiar(i, 'acreditacion', e.target.value)} className="input text-xs" />
                ) : (
                  <input type="hidden" name="ins_acreditacion" value={f.fecha} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {cheque ? (
                  <>
                    <div><label className="label">N°</label><input name="ins_numero" value={f.numero} onChange={(e) => cambiar(i, 'numero', e.target.value)} className="input text-xs" /></div>
                    <div><label className="label">Banco</label><input name="ins_banco" value={f.banco} onChange={(e) => cambiar(i, 'banco', e.target.value)} className="input text-xs" /></div>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="ins_numero" value="" />
                    <input type="hidden" name="ins_banco" value="" />
                  </>
                )}
              </div>
              <div>
                {filas.length > 1 && (
                  <button type="button" onClick={() => setFilas((fs) => fs.filter((_, k) => k !== i))} className="btn-secondary text-xs" aria-label="Quitar instrumento">×</button>
                )}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={() => setFilas((fs) => [...fs, nuevaFila()])} className="text-xs underline underline-offset-2 text-accent-strong">
          + Agregar instrumento (otro cheque, retención…)
        </button>

        {hayPesosSobreExtranjera && (
          <div className="max-w-xs">
            <label className="label">Cotización del cobro (pesos por {moneda})</label>
            <input name="cotizacion" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} className="input text-xs font-mono" inputMode="decimal"
              placeholder={preview.r?.cotizacion ? `implícita: ${preview.r.cotizacion.toLocaleString('es-AR', { maximumFractionDigits: 4 })}` : 'vacío = cancela todo el saldo'} />
            <p className="mt-1 text-[11px] text-ink-mute">Vacía, se asume que los pesos cancelan todo el saldo. La diferencia contra el TC de la factura genera un ajuste en el P&L.</p>
          </div>
        )}

        {sugerencia.sugerir && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={cerrarRetencion} onChange={(e) => setCerrarRetencion(e.target.checked)} className="accent-accent" />
            Faltan {formatMoney(sugerencia.monto)}: cerrarlos como retención sufrida
          </label>
        )}

        <div>
          <label className="label">Nota (opcional)</label>
          <input name="nota" className="input text-xs" placeholder="Ej.: recibo 0001-00001234" />
        </div>
      </div>

      {preview.error && <p className="text-[13px] text-red-700">{preview.error}</p>}
      {preview.r && preview.r.faltante > 0 && (
        <p className="text-[13px] text-ink-mute">Queda un saldo de {fmt(preview.r.faltante, moneda)}: las facturas quedan parcialmente cobradas.</p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!preview.r}>Registrar cobro</button>
      </div>
    </form>
  );
}
