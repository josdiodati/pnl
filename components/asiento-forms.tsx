'use client';

import { useMemo, useState } from 'react';
import { crearAsientoAction, crearVentaAction } from '@/app/(app)/[empresaSlug]/asientos/actions';
import { DistribucionEditor, type OpcionId, type PlantillaOpcion } from './distribucion-editor';

export type CategoriaOpcion = { id: string; nombre: string; tipo: 'INGRESO' | 'EGRESO'; padreId: string | null };
export type ContraparteOpcion = { id: string; razonSocial: string; tipo: 'PROVEEDOR' | 'CLIENTE' | 'AMBOS' };

// Manual entry (salaries, taxes, adjustments — the biggest chunk of the real
// P&L) and manual sale. Both share the distribution editor with live amounts.

export function AsientoManualForm({
  empresaSlug,
  categorias,
  contrapartes,
  centros,
  clientes,
  proyectos,
  plantillas,
  puedeValidar,
}: {
  empresaSlug: string;
  categorias: CategoriaOpcion[];
  contrapartes: ContraparteOpcion[];
  centros: OpcionId[];
  clientes: OpcionId[];
  proyectos: OpcionId[];
  plantillas: PlantillaOpcion[];
  puedeValidar: boolean;
}) {
  const [categoriaId, setCategoriaId] = useState('');
  const [total, setTotal] = useState('');
  const categoriaSel = categorias.find((c) => c.id === categoriaId);
  const totalFirmado = useMemo(() => {
    const t = Number(total.replace(',', '.'));
    if (!categoriaSel || Number.isNaN(t)) return null;
    return (categoriaSel.tipo === 'INGRESO' ? 1 : -1) * t;
  }, [total, categoriaSel]);

  return (
    <form action={crearAsientoAction} className="space-y-3">
      <input type="hidden" name="empresaSlug" value={empresaSlug} />
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Fecha de devengamiento</label>
          <input type="date" name="fechaDevengamiento" required className="input" />
        </div>
        <div>
          <label className="label">Categoría</label>
          <select name="categoriaId" required value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="input">
            <option value="">Elegir…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.padreId ? '· ' : ''}{c.nombre} ({c.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Importe (negativo = ajuste en contra)</label>
          <input
            name="total"
            required
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="input text-right tabular-nums"
            placeholder="0,00"
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Descripción</label>
          <input name="descripcion" className="input" placeholder="Sueldos BPO junio, ajuste IIBB, …" />
        </div>
        <div>
          <label className="label">Contraparte (opcional)</label>
          <select name="contraparteId" className="input" defaultValue="">
            <option value="">— Sin contraparte —</option>
            {contrapartes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
        </div>
      </div>
      <DistribucionEditor centros={centros} clientes={clientes} proyectos={proyectos} plantillas={plantillas} totalFirmado={totalFirmado} />
      <div>
        <label className="label">Adjunto (opcional)</label>
        <input type="file" name="adjunto" className="text-sm" accept="application/pdf,image/jpeg,image/png,image/webp" />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary">Crear asiento</button>
        {puedeValidar && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" name="validarAlGuardar" /> Validar al guardar
          </label>
        )}
      </div>
    </form>
  );
}

const TIPOS_VENTA = ['FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_E', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C', 'RECIBO', 'OTRO'];

export function VentaManualForm({
  empresaSlug,
  categorias,
  contrapartes,
  centros,
  clientes,
  proyectos,
  plantillas,
  puedeValidar,
}: {
  empresaSlug: string;
  categorias: CategoriaOpcion[];
  contrapartes: ContraparteOpcion[];
  centros: OpcionId[];
  clientes: OpcionId[];
  proyectos: OpcionId[];
  plantillas: PlantillaOpcion[];
  puedeValidar: boolean;
}) {
  const [total, setTotal] = useState('');
  const [tipo, setTipo] = useState('FACTURA_A');
  const categoriasIngreso = categorias.filter((c) => c.tipo === 'INGRESO');
  const clientesVenta = contrapartes.filter((c) => c.tipo !== 'PROVEEDOR');
  const totalFirmado = useMemo(() => {
    const t = Number(total.replace(',', '.'));
    if (Number.isNaN(t) || !total) return null;
    return tipo.startsWith('NOTA_CREDITO') ? -t : t;
  }, [total, tipo]);

  return (
    <form action={crearVentaAction} className="space-y-3">
      <input type="hidden" name="empresaSlug" value={empresaSlug} />
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Fecha de emisión</label>
          <input type="date" name="fechaDevengamiento" required className="input" />
        </div>
        <div>
          <label className="label">Cliente</label>
          <select name="contraparteId" className="input" defaultValue="">
            <option value="">— Sin cliente —</option>
            {clientesVenta.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría de ingreso</label>
          <select name="categoriaId" required className="input" defaultValue="">
            <option value="">Elegir…</option>
            {categoriasIngreso.map((c) => (
              <option key={c.id} value={c.id}>{c.padreId ? '· ' : ''}{c.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tipo de comprobante emitido</label>
          <select name="tipoComprobante" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_VENTA.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Punto de venta</label>
          <input name="puntoVenta" className="input" placeholder="0001" />
        </div>
        <div>
          <label className="label">Número</label>
          <input name="numero" className="input" placeholder="00001234" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div>
          <label className="label">Neto gravado</label>
          <input name="netoGravado" inputMode="decimal" className="input text-right tabular-nums" />
        </div>
        <div>
          <label className="label">IVA 21%</label>
          <input name="iva21" inputMode="decimal" className="input text-right tabular-nums" />
        </div>
        <div>
          <label className="label">IVA 10,5%</label>
          <input name="iva105" inputMode="decimal" className="input text-right tabular-nums" />
        </div>
        <div>
          <label className="label">No gravado</label>
          <input name="noGravadoExento" inputMode="decimal" className="input text-right tabular-nums" />
        </div>
        <div>
          <label className="label">TOTAL</label>
          <input
            name="total"
            required
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="input text-right tabular-nums font-semibold"
          />
        </div>
      </div>
      <div>
        <label className="label">Descripción</label>
        <input name="descripcion" className="input" placeholder="Servicio BPO cuenta Telecom, junio" />
      </div>
      <DistribucionEditor centros={centros} clientes={clientes} proyectos={proyectos} plantillas={plantillas} totalFirmado={totalFirmado} />
      <div>
        <label className="label">Adjunto del PDF emitido (opcional)</label>
        <input type="file" name="adjunto" className="text-sm" accept="application/pdf,image/jpeg,image/png,image/webp" />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary">Registrar venta</button>
        {puedeValidar && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" name="validarAlGuardar" /> Validar al guardar
          </label>
        )}
      </div>
    </form>
  );
}
