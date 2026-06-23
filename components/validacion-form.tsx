'use client';

import { useMemo, useState } from 'react';
import { validarAction } from '@/app/(app)/[empresaSlug]/validacion/actions';
import { DistribucionEditor, type OpcionId, type PlantillaOpcion } from './distribucion-editor';

// Right-hand form of the side-by-side validation screen. Fields flagged by the
// deterministic checks come highlighted in yellow with the reason; the happy
// path (clean voucher, known supplier, single cost center) is ONE click on
// "Validar y siguiente".

export type CampoMovimiento = {
  id: string;
  estado: string;
  arcaEstado: string;
  arcaDetalle: string | null;
  fechaDevengamiento: string;
  tipoComprobante: string;
  puntoVenta: string;
  numero: string;
  cuitEmisor: string;
  cuitReceptor: string;
  esVenta: boolean;
  contraparteId: string;
  descripcion: string;
  moneda: string;
  cae: string;
  importes: Record<string, number | null>;
  camposRevisar: Record<string, string>;
  duplicados: string[];
  categoriaId: string;
  lineas: { centroCostoId: string; clienteId: string; proyectoId: string; porcentaje: string }[];
};

export type CategoriaOpcion = { id: string; nombre: string; tipo: 'INGRESO' | 'EGRESO'; padreId: string | null };

export type ContraparteOpcion = {
  id: string;
  razonSocial: string;
  cuit: string;
  categoriaDefaultId: string | null;
  instruccionesExtraccion: string | null;
};

const TIPOS = [
  'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_E',
  'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C',
  'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C',
  'TICKET', 'RECIBO', 'OTRO',
];

const IMPORTES: { campo: string; label: string }[] = [
  { campo: 'netoGravado', label: 'Neto gravado' },
  { campo: 'iva21', label: 'IVA 21%' },
  { campo: 'iva105', label: 'IVA 10,5%' },
  { campo: 'iva27', label: 'IVA 27%' },
  { campo: 'percepcionesIva', label: 'Percep. IVA' },
  { campo: 'percepcionesIibb', label: 'Percep. IIBB' },
  { campo: 'otrosTributos', label: 'Otros tributos' },
  { campo: 'noGravadoExento', label: 'No gravado / exento' },
];

function Campo({
  label,
  revisar,
  children,
}: {
  label: string;
  revisar?: string;
  children: React.ReactNode;
}) {
  return (
    <div title={revisar}>
      <label className="label">
        {label}
        {revisar && <span className="ml-1 text-amber-600" title={revisar}>⚠</span>}
      </label>
      <div className={revisar ? 'rounded-md ring-2 ring-amber-400' : ''}>{children}</div>
      {revisar && <p className="text-[11px] text-amber-700 mt-0.5">{revisar}</p>}
    </div>
  );
}

export function ValidacionForm({
  empresaSlug,
  mov,
  contrapartes,
  categorias,
  centros,
  clientes,
  proyectos,
  plantillas,
  reglaSugerida,
}: {
  empresaSlug: string;
  mov: CampoMovimiento;
  contrapartes: ContraparteOpcion[];
  categorias: CategoriaOpcion[];
  centros: OpcionId[];
  clientes: OpcionId[];
  proyectos: OpcionId[];
  plantillas: PlantillaOpcion[];
  reglaSugerida?: string | null;
}) {
  const [contraparteId, setContraparteId] = useState(mov.contraparteId);
  const [categoriaId, setCategoriaId] = useState(mov.categoriaId);
  const [tipoComprobante, setTipoComprobante] = useState(mov.tipoComprobante);
  const [total, setTotal] = useState<string>(mov.importes.total != null ? String(mov.importes.total) : '');
  const [overrideNoFiscal, setOverrideNoFiscal] = useState(false);

  const contraparteSel = contrapartes.find((c) => c.id === contraparteId);
  const categoriaSel = categorias.find((c) => c.id === categoriaId);

  // Total firmado (para mostrar el importe por línea en vivo en el editor).
  const totalFirmado = useMemo(() => {
    const t = Number(total.replace(',', '.'));
    if (!categoriaSel || Number.isNaN(t)) return null;
    let signo = categoriaSel.tipo === 'INGRESO' ? 1 : -1;
    if (tipoComprobante.startsWith('NOTA_CREDITO')) signo *= -1;
    return signo * t;
  }, [total, categoriaSel, tipoComprobante]);

  const r = mov.camposRevisar;

  return (
    <form action={validarAction} className="space-y-4">
      <input type="hidden" name="empresaSlug" value={empresaSlug} />
      <input type="hidden" name="movimientoId" value={mov.id} />

      {mov.duplicados.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ <strong>Posible duplicado:</strong> ya existe otro comprobante con el mismo CUIT + tipo + punto de venta +
          número ({mov.duplicados.length} coincidencia{mov.duplicados.length !== 1 ? 's' : ''}). Revisalo antes de validar.
        </div>
      )}

      {mov.arcaEstado === 'INVALIDO' && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 space-y-2">
          <p>
            ⚠ <strong>ARCA: comprobante INVÁLIDO.</strong> {mov.arcaDetalle ?? ''}
          </p>
          <label className="flex items-start gap-2 font-medium">
            <input type="checkbox" name="confirmarArcaInvalido" className="mt-0.5" />
            Este comprobante figura como inválido en ARCA; confirmo validarlo igual (queda registrado en auditoría).
          </label>
        </div>
      )}

      {(mov.arcaEstado === 'NO_VERIFICADO' || mov.arcaEstado === 'ERROR_CONSULTA') && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
          <p>
            ⚠ <strong>ARCA: no constatado.</strong> Este comprobante no figura como válido en ARCA
            (sin CAE, no fiscal o servicio extranjero como AWS / Claude / Google).
          </p>
          <label className="flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              name="overrideNoFiscal"
              className="mt-0.5"
              checked={overrideNoFiscal}
              onChange={(e) => setOverrideNoFiscal(e.target.checked)}
            />
            Lo valido igual con override (no fiscal / extranjero). Queda registrado en auditoría.
          </label>
          <input
            type="text"
            name="overrideNoFiscalMotivo"
            placeholder="Motivo del override (obligatorio)"
            className="input w-full"
            required={overrideNoFiscal}
            disabled={!overrideNoFiscal}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Campo label="Fecha del comprobante (devengamiento)" revisar={r.fechaEmision}>
          <input type="date" name="fechaDevengamiento" defaultValue={mov.fechaDevengamiento} required className="input" />
        </Campo>
        <Campo label="Tipo de comprobante" revisar={r.tipoComprobante}>
          <select name="tipoComprobante" value={tipoComprobante} onChange={(e) => setTipoComprobante(e.target.value)} className="input">
            <option value="">—</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Punto de venta" revisar={r.puntoVenta}>
          <input name="puntoVenta" defaultValue={mov.puntoVenta} className="input" />
        </Campo>
        <Campo label="Número" revisar={r.numero}>
          <input name="numero" defaultValue={mov.numero} className="input" />
        </Campo>
        <Campo label={mov.esVenta ? 'CUIT del emisor (nuestro)' : 'CUIT del emisor'} revisar={r.cuitEmisor}>
          <input name="cuitEmisor" defaultValue={mov.cuitEmisor} className="input" />
        </Campo>
        {mov.esVenta && (
          <Campo label="CUIT receptor (cliente)">
            <input value={mov.cuitReceptor || '—'} readOnly disabled className="input bg-slate-50 text-slate-600" />
          </Campo>
        )}
        <Campo label="CAE" revisar={r.cae}>
          <input name="cae" defaultValue={mov.cae} className="input" />
        </Campo>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Campo label="Contraparte" revisar={r.contraparte}>
          <select
            name="contraparteId"
            value={contraparteId}
            onChange={(e) => {
              setContraparteId(e.target.value);
              const c = contrapartes.find((x) => x.id === e.target.value);
              if (c?.categoriaDefaultId && !categoriaId) setCategoriaId(c.categoriaDefaultId);
            }}
            className="input"
          >
            <option value="">— Sin contraparte —</option>
            {contrapartes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial} ({c.cuit})</option>
            ))}
            <option value="__nueva__">+ Crear contraparte nueva…</option>
          </select>
        </Campo>

        {contraparteId === '__nueva__' && (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-blue-200 bg-blue-50 p-2">
            <div>
              <label className="label">CUIT nuevo</label>
              <input name="nuevaContraparte_cuit" defaultValue={mov.cuitEmisor} className="input" />
            </div>
            <div>
              <label className="label">Razón social</label>
              <input name="nuevaContraparte_razonSocial" className="input" />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select name="nuevaContraparte_tipo" className="input" defaultValue="PROVEEDOR">
                <option value="PROVEEDOR">Proveedor</option>
                <option value="CLIENTE">Cliente</option>
                <option value="AMBOS">Ambos</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoría (opcional)" revisar={r.categoria}>
            <select name="categoriaId" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="input">
              <option value="">Sin asignar todavía</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.padreId ? '· ' : ''}{c.nombre} ({c.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'})
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Moneda">
            <select name="moneda" defaultValue={mov.moneda} className="input">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="OTRA">Otra</option>
            </select>
          </Campo>
        </div>

        <Campo label="Descripción">
          <input name="descripcion" defaultValue={mov.descripcion} className="input" />
        </Campo>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="text-xs font-semibold text-slate-500 px-1">Importes</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {IMPORTES.map(({ campo, label }) => (
            <Campo key={campo} label={label} revisar={r[campo]}>
              <input
                name={campo}
                defaultValue={mov.importes[campo] ?? ''}
                inputMode="decimal"
                className="input text-right tabular-nums"
              />
            </Campo>
          ))}
        </div>
        <div className="mt-2 w-48">
          <Campo label="TOTAL" revisar={r.total}>
            <input
              name="total"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              required
              className="input text-right tabular-nums font-semibold"
            />
          </Campo>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="text-xs font-semibold text-slate-500 px-1">Imputación</legend>
        {reglaSugerida && (
          <p className="mb-2 text-[11px] text-sky-700">⚡ Pre-llenado por la regla «{reglaSugerida}» — revisalo antes de guardar.</p>
        )}
        <p className="mb-2 text-[11px] text-slate-500">
          Completá categoría + distribución para dejarlo <strong>Asignado</strong> en un paso. Si lo dejás sin categoría,
          queda <strong>Validado</strong> y se asigna después en la cola de Asignación.
        </p>
        <DistribucionEditor
          centros={centros}
          clientes={clientes}
          proyectos={proyectos}
          plantillas={plantillas}
          inicial={mov.lineas.length ? mov.lineas : undefined}
          totalFirmado={totalFirmado}
        />
      </fieldset>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">
          Instrucciones de extracción para este emisor {contraparteSel?.instruccionesExtraccion ? '(ya tiene)' : ''}
        </summary>
        <textarea
          name="instruccionesExtraccion"
          rows={2}
          defaultValue={contraparteSel?.instruccionesExtraccion ?? ''}
          placeholder="Si el OCR siempre se equivoca en lo mismo con este proveedor, anotá acá la corrección: se inyecta al prompt en las próximas extracciones."
          className="input mt-1"
        />
      </details>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" name="siguiente" value="1" className="btn-success">
          ✓ Validar y siguiente
        </button>
        <button type="submit" className="btn-secondary">Validar</button>
      </div>
    </form>
  );
}
