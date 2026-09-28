'use client';

import { useMemo, useState } from 'react';
import { calcularReparto, sugerenciaRetencion, type ResultadoReparto } from '@/lib/cobranzas/reparto';
import { INSTRUMENTOS, INSTRUMENTO_LABEL, ES_CHEQUE, INSTRUMENTOS_BANCARIOS } from '@/lib/cobranzas/labels';
import { parsearImporteAr, formatMoney } from '@/lib/format';
import { registrarCobroAction, editarCobroAction } from '@/app/(app)/[empresaSlug]/ventas/actions';

// Registrar un cobro: una o varias facturas (misma moneda) + uno o varios
// instrumentos. La vista previa corre el MISMO reparto que el servidor
// (lib/cobranzas/reparto), así lo que se ve es lo que se guarda.
// Con `edicion` el mismo formulario edita un cobro existente: las facturas
// muestran el saldo sin contar este cobro; si el cobro está confirmado por el
// resumen (o tiene un cheque rechazado) sólo se editan n°, banco y nota.

export type FacturaForm = {
  id: string;
  etiqueta: string;
  cliente: string;
  fechaIso: string;
  saldo: number;
  moneda: string;
  tcFactura: number | null;
};

export type Fila = { cobroId: string; tipo: string; monto: string; moneda: string; fecha: string; acreditacion: string; numero: string; banco: string };

export type EdicionCobro = { grupo: string; filas: Fila[]; cotizacion: string; nota: string; soloDatos: string | null };

/** Etiqueta del número según el instrumento; null si no lleva número. */
function etiquetaNumero(tipo: string): string | null {
  if (ES_CHEQUE.has(tipo)) return 'N° cheque';
  if (tipo === 'RETENCION') return 'N° certificado';
  if (tipo === 'NOTA_CREDITO') return 'N° NC';
  if (tipo === 'EFECTIVO') return null;
  return 'Referencia';
}

const aDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (n: number, moneda: string) => (moneda === 'ARS' ? formatMoney(n) : `${formatMoney(n).replace('$ ', '')} ${moneda}`);

export function RegistrarCobroForm({
  slug,
  facturas,
  hoyIso,
  volver,
  errorEn,
  edicion,
}: {
  slug: string;
  facturas: FacturaForm[];
  hoyIso: string;
  volver: string;
  errorEn: string;
  edicion?: EdicionCobro;
}) {
  const soloDatos = edicion?.soloDatos ?? null;
  const moneda = facturas[0]?.moneda ?? 'ARS';
  const saldoTotal = facturas.reduce((s, f) => s + f.saldo, 0);
  const nuevaFila = (monto = ''): Fila => ({ cobroId: '', tipo: 'TRANSFERENCIA', monto, moneda: 'ARS', fecha: hoyIso, acreditacion: hoyIso, numero: '', banco: '' });
  const [filas, setFilas] = useState<Fila[]>(edicion?.filas ?? [nuevaFila(moneda === 'ARS' ? String(Math.round(saldoTotal * 100) / 100) : '')]);
  const [cotizacion, setCotizacion] = useState(edicion?.cotizacion ?? '');
  // Al editar no se sugiere retención automática: se agrega como instrumento.
  const [cerrarRetencion, setCerrarRetencion] = useState(!edicion);

  const cambiar = (i: number, campo: keyof Fila, valor: string) =>
    setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, [campo]: valor, ...(campo === 'fecha' && !ES_CHEQUE.has(f.tipo) ? { acreditacion: valor } : {}) } : f)));

  const instrumentos = filas
    .map((f) => ({ ...f, montoNum: parsearImporteAr(f.monto) }))
    .filter((f) => f.montoNum != null && !Number.isNaN(f.montoNum) && f.montoNum > 0);

  // Monto de los instrumentos expresado en la moneda de las facturas (para la sugerencia de retención).
  const totalEnMoneda = instrumentos.reduce((s, f) => s + (f.moneda === moneda ? f.montoNum! : 0), 0);
  const sugerencia = moneda === 'ARS' && !edicion ? sugerenciaRetencion(saldoTotal, totalEnMoneda, 'ARS') : { sugerir: false, monto: 0 };

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
    <form action={edicion ? editarCobroAction : registrarCobroAction} className="space-y-4">
      <input type="hidden" name="empresaSlug" value={slug} />
      {edicion && <input type="hidden" name="grupo" value={edicion.grupo} />}
      <input type="hidden" name="volver" value={volver} />
      <input type="hidden" name="errorEn" value={errorEn} />
      {facturas.map((f) => <input key={f.id} type="hidden" name="ventaId" value={f.id} />)}
      {sugerencia.sugerir && cerrarRetencion && <input type="hidden" name="cerrarRetencion" value="on" />}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Factura</th><th>Cliente</th><th>Fecha</th><th className="text-right">{edicion ? 'Saldo sin este cobro' : 'Saldo'}</th><th className="text-right">Cancela</th><th className="text-right">Queda</th>{moneda !== 'ARS' && <th className="text-right">Dif. de cambio</th>}</tr>
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
        {soloDatos && (
          <p className="text-[12px] text-ink-mute">{soloDatos} Sólo se pueden cambiar el número, el banco y la nota.</p>
        )}
        {filas.map((f, i) => {
          const cheque = ES_CHEQUE.has(f.tipo);
          const lblNumero = etiquetaNumero(f.tipo);
          const conBanco = INSTRUMENTOS_BANCARIOS.has(f.tipo);
          const fijo = (valor: string) => <p className="input text-xs bg-transparent border-transparent px-0 font-mono">{valor || '—'}</p>;
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[10rem_10rem_6rem_9rem_9rem_1fr_auto] items-end">
              <input type="hidden" name="ins_cobroId" value={f.cobroId} />
              <div>
                <label className="label">Tipo</label>
                {soloDatos ? (
                  <>{fijo(INSTRUMENTO_LABEL[f.tipo])}<input type="hidden" name="ins_tipo" value={f.tipo} /></>
                ) : (
                  <select name="ins_tipo" value={f.tipo} onChange={(e) => cambiar(i, 'tipo', e.target.value)} className="input text-xs">
                    {INSTRUMENTOS.map((t) => <option key={t} value={t}>{INSTRUMENTO_LABEL[t]}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="label">Monto</label>
                <input name="ins_monto" value={f.monto} onChange={(e) => cambiar(i, 'monto', e.target.value)} readOnly={Boolean(soloDatos)} className={`input text-xs font-mono ${soloDatos ? 'opacity-60' : ''}`} inputMode="decimal" placeholder="0,00" />
              </div>
              <div>
                <label className="label">Moneda</label>
                {soloDatos ? (
                  <>{fijo(f.moneda)}<input type="hidden" name="ins_moneda" value={f.moneda} /></>
                ) : (
                  <select name="ins_moneda" value={f.moneda} onChange={(e) => cambiar(i, 'moneda', e.target.value)} className="input text-xs">
                    <option value="ARS">ARS</option>
                    {moneda !== 'ARS' && <option value={moneda}>{moneda}</option>}
                  </select>
                )}
              </div>
              <div>
                <label className="label">{cheque ? 'Recibido' : 'Fecha'}</label>
                <input type="date" name="ins_fecha" value={f.fecha} onChange={(e) => cambiar(i, 'fecha', e.target.value)} readOnly={Boolean(soloDatos)} className={`input text-xs ${soloDatos ? 'opacity-60' : ''}`} />
              </div>
              <div>
                <label className="label">{cheque ? 'Fecha de cobro' : ' '}</label>
                {cheque ? (
                  <input type="date" name="ins_acreditacion" value={f.acreditacion} onChange={(e) => cambiar(i, 'acreditacion', e.target.value)} readOnly={Boolean(soloDatos)} className={`input text-xs ${soloDatos ? 'opacity-60' : ''}`} />
                ) : (
                  <input type="hidden" name="ins_acreditacion" value={soloDatos ? f.acreditacion : f.fecha} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {lblNumero ? (
                  <div><label className="label">{lblNumero}</label><input name="ins_numero" value={f.numero} onChange={(e) => cambiar(i, 'numero', e.target.value)} className="input text-xs" /></div>
                ) : (
                  <input type="hidden" name="ins_numero" value="" />
                )}
                {conBanco ? (
                  <div>
                    <label className="label">Banco</label>
                    <input name="ins_banco" value={f.banco} onChange={(e) => cambiar(i, 'banco', e.target.value)} className="input text-xs" placeholder={cheque ? 'emisor' : 'Ej.: Galicia'} />
                  </div>
                ) : (
                  <input type="hidden" name="ins_banco" value="" />
                )}
              </div>
              <div>
                {filas.length > 1 && !soloDatos && (
                  <button type="button" onClick={() => setFilas((fs) => fs.filter((_, k) => k !== i))} className="btn-secondary text-xs" aria-label="Quitar instrumento">×</button>
                )}
              </div>
            </div>
          );
        })}
        {!soloDatos && (
          <button type="button" onClick={() => setFilas((fs) => [...fs, nuevaFila()])} className="text-xs underline underline-offset-2 text-accent-strong">
            + Agregar instrumento (otro cheque, retención…)
          </button>
        )}

        {hayPesosSobreExtranjera && (
          <div className="max-w-xs">
            <label className="label">Cotización del cobro (pesos por {moneda})</label>
            <input name="cotizacion" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} readOnly={Boolean(soloDatos)} className="input text-xs font-mono" inputMode="decimal"
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
          <input name="nota" defaultValue={edicion?.nota ?? ''} className="input text-xs" placeholder="Ej.: recibo 0001-00001234" />
        </div>
      </div>

      {preview.error && <p className="text-[13px] text-red-700">{preview.error}</p>}
      {preview.r && preview.r.faltante > 0 && (
        <p className="text-[13px] text-ink-mute">Queda un saldo de {fmt(preview.r.faltante, moneda)}: las facturas quedan parcialmente cobradas.</p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!preview.r && !soloDatos}>{edicion ? 'Guardar cambios' : 'Registrar cobro'}</button>
      </div>
    </form>
  );
}
