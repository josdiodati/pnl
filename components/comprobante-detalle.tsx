import { formatMoney, formatMoneyFirmado, formatFecha, formatFechaHora } from '@/lib/format';
import { formatearCuit, mensajeAritmetica } from '@/lib/checks';
import { IMPORTES } from '@/lib/movimientos/importes';
import { nombreContraparte } from '@/lib/movimientos/nombre-contraparte';
import { totalFirmadoDe } from '@/lib/movimientos/query';
import { importesPorLinea } from '@/lib/movimientos/distribucion';
import { ESTADO_LABEL } from '@/lib/movimientos/estados';

// Detalle de solo lectura de un comprobante ya validado/asignado/anulado, para
// las pantallas donde no hay formulario. Sigue el MISMO orden de secciones que
// la pantalla de validación, para que quien valida encuentre cada dato en el
// mismo lugar en las dos vistas.

type Opcion = { id: string; nombre: string };

export type MovimientoDetalle = {
  id: string;
  estado: string;
  origen: string;
  canalIngreso: string | null;
  fechaDevengamiento: Date | null;
  tipoComprobante: string | null;
  puntoVenta: string | null;
  numero: string | null;
  cuitEmisor: string | null;
  cae: string | null;
  vencimientoCae: Date | null;
  moneda: string;
  descripcion: string | null;
  total: unknown;
  motivoAnulacion: string | null;
  arcaEstado: string;
  arcaDetalle: string | null;
  arcaConsultadoAt: Date | null;
  qrEstado: string | null;
  archivoNombre: string | null;
  archivoMime: string | null;
  archivoHash: string | null;
  extraccionRaw: unknown;
  camposRevisar: unknown;
  flags: unknown;
  createdAt: Date;
  contraparte: { razonSocial: string; cuit: string } | null;
  categoria: { nombre: string; tipo: string } | null;
  creadoPor: { nombre: string } | null;
  validadoPor: { nombre: string } | null;
  lineas: { id: string; centroCostoId: string; clienteId: string | null; proyectoId: string | null; porcentaje: unknown }[];
  [k: string]: unknown;
};

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words">{children ?? '—'}</dd>
    </>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{titulo}</h3>
      {children}
    </section>
  );
}

const n = (v: unknown) => (v == null ? null : Number(v));

export function ComprobanteDetalle({
  mov,
  centros,
  clientes,
  proyectos,
}: {
  mov: MovimientoDetalle;
  centros: Opcion[];
  clientes: Opcion[];
  proyectos: Opcion[];
}) {
  const extr = (mov.extraccionRaw ?? {}) as Record<string, unknown>;
  const revisar = (mov.camposRevisar ?? {}) as Record<string, string>;
  const flags = (mov.flags ?? {}) as Record<string, unknown>;
  const duplicados = (flags.duplicados as string[] | undefined) ?? [];

  const importes = Object.fromEntries(IMPORTES.map(({ campo }) => [campo, n(mov[campo])]));
  const desvio = mensajeAritmetica({ ...importes, total: n(mov.total) });

  // Importe que le toca a cada línea, igual que en el editor de distribución.
  const firmado = totalFirmadoDe(mov as never);
  const lineas = mov.lineas.map((l) => ({
    centroCostoId: l.centroCostoId,
    clienteId: l.clienteId,
    proyectoId: l.proyectoId,
    porcentaje: Number(l.porcentaje),
  }));
  let porLinea: number[] = [];
  if (firmado != null && lineas.length) {
    try {
      porLinea = importesPorLinea(firmado, lineas);
    } catch {
      porLinea = [];
    }
  }

  const nombreDe = (lista: Opcion[], id: string | null) => (id ? (lista.find((o) => o.id === id)?.nombre ?? '?') : null);

  return (
    <div className="space-y-4 text-sm">
      <Seccion titulo="Comprobante">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Fila label="Tipo">
            {mov.tipoComprobante?.replace(/_/g, ' ') ?? null}{' '}
            {mov.puntoVenta ? `${mov.puntoVenta}-` : ''}{mov.numero ?? ''}
          </Fila>
          <Fila label="Fecha">{formatFecha(mov.fechaDevengamiento)}</Fila>
          <Fila label="Contraparte">
            {nombreContraparte(mov as never).nombre}
            {!mov.contraparte && <span className="ml-1 text-xs text-amber-700">(no está en el maestro)</span>}
          </Fila>
          <Fila label="CUIT emisor">
            {mov.cuitEmisor ? formatearCuit(mov.cuitEmisor) : null}
            {typeof extr.razonSocialEmisor === 'string' && (
              <span className="text-slate-500"> — {extr.razonSocialEmisor}</span>
            )}
          </Fila>
          <Fila label="CUIT receptor">
            {typeof extr.cuitReceptorEfectivo === 'string' || typeof extr.cuitReceptor === 'string'
              ? formatearCuit(String(extr.cuitReceptorEfectivo ?? extr.cuitReceptor))
              : null}
            {typeof extr.razonSocialReceptor === 'string' && (
              <span className="text-slate-500"> — {extr.razonSocialReceptor}</span>
            )}
          </Fila>
          <Fila label="CAE">
            {mov.cae}
            {mov.vencimientoCae && <span className="text-slate-500"> — vence {formatFecha(mov.vencimientoCae)}</span>}
          </Fila>
          <Fila label="Moneda">{mov.moneda}</Fila>
          <Fila label="Descripción">{mov.descripcion}</Fila>
          {typeof extr.observaciones === 'string' && extr.observaciones && (
            <Fila label="Observaciones (extracción)">{extr.observaciones}</Fila>
          )}
          <Fila label="Fiscal argentino">{extr.esComprobanteFiscalArg === true ? 'Sí' : 'No'}</Fila>
          {mov.motivoAnulacion && (
            <Fila label="Motivo de anulación">
              <span className="text-red-700">{mov.motivoAnulacion}</span>
            </Fila>
          )}
        </dl>
      </Seccion>

      <Seccion titulo="Importes">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {IMPORTES.map(({ campo, label }) => (
            <Fila key={campo} label={label}>
              <span className="tabular-nums">{formatMoney(importes[campo])}</span>
            </Fila>
          ))}
          <dt className="text-slate-500 font-semibold border-t border-slate-200 pt-1">TOTAL</dt>
          <dd className="tabular-nums font-semibold border-t border-slate-200 pt-1">{formatMoney(n(mov.total))}</dd>
        </dl>
        {desvio ? (
          <p className="mt-1 text-[11px] text-amber-700">⚠ {desvio}</p>
        ) : (
          n(mov.total) != null && <p className="mt-1 text-[11px] text-emerald-700">Los componentes suman el total.</p>
        )}
      </Seccion>

      <Seccion titulo="Imputación">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Fila label="Categoría">
            {mov.categoria ? `${mov.categoria.nombre} (${mov.categoria.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'})` : null}
          </Fila>
        </dl>
        {mov.lineas.length > 0 ? (
          <table className="table-base mt-2">
            <thead>
              <tr>
                <th>Centro de costo</th>
                <th>Cliente</th>
                <th>Proyecto</th>
                <th className="text-right">%</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {mov.lineas.map((l, i) => (
                <tr key={l.id}>
                  <td>{nombreDe(centros, l.centroCostoId) ?? '?'}</td>
                  <td>{nombreDe(clientes, l.clienteId) ?? '—'}</td>
                  <td>{nombreDe(proyectos, l.proyectoId) ?? '—'}</td>
                  <td className="num">{Number(l.porcentaje).toLocaleString('es-AR')}%</td>
                  <td className="num">{porLinea[i] != null ? formatMoneyFirmado(porLinea[i]) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-500 mt-1">Sin distribución cargada.</p>
        )}
      </Seccion>

      <Seccion titulo="Trazabilidad">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Fila label="Estado">{ESTADO_LABEL[mov.estado as keyof typeof ESTADO_LABEL] ?? mov.estado}</Fila>
          <Fila label="Origen">{mov.origen.replace(/_/g, ' ').toLowerCase()}</Fila>
          <Fila label="Canal">{mov.canalIngreso}</Fila>
          <Fila label="Cargado por">
            {mov.creadoPor?.nombre} <span className="text-slate-500">— {formatFechaHora(mov.createdAt)}</span>
          </Fila>
          <Fila label="Validado por">
            {mov.estado === 'VALIDADO' || mov.estado === 'ASIGNADO'
              ? (mov.validadoPor?.nombre ?? 'Automático (sistema)')
              : null}
          </Fila>
          <Fila label="ARCA">
            {mov.arcaEstado}
            {mov.arcaDetalle && <span className="text-slate-500"> — {mov.arcaDetalle}</span>}
            {mov.arcaConsultadoAt && (
              <span className="text-slate-500"> ({formatFechaHora(mov.arcaConsultadoAt)})</span>
            )}
          </Fila>
          <Fila label="QR">{mov.qrEstado}</Fila>
          {duplicados.length > 0 && (
            <Fila label="Duplicados">
              <span className="text-red-700">{duplicados.length} comprobante(s) con la misma clave fiscal</span>
            </Fila>
          )}
          {Object.keys(revisar).length > 0 && (
            <Fila label="Campos marcados">
              <ul className="list-disc list-inside text-amber-700">
                {Object.entries(revisar).map(([campo, motivo]) => (
                  <li key={campo}>
                    <span className="font-medium">{campo}</span>: {motivo}
                  </li>
                ))}
              </ul>
            </Fila>
          )}
          <Fila label="Archivo">
            {mov.archivoNombre}
            {mov.archivoMime && <span className="text-slate-500"> ({mov.archivoMime})</span>}
          </Fila>
          {mov.archivoHash && (
            <Fila label="SHA-256">
              <span className="text-[10px] break-all text-slate-400">{mov.archivoHash}</span>
            </Fila>
          )}
        </dl>
      </Seccion>

      {mov.extraccionRaw != null && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Extracción cruda (JSON)</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[10px] leading-tight">
            {JSON.stringify(mov.extraccionRaw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
