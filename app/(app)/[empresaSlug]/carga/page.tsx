import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { resumirLote, estadoLote, detalleLote, RESULTADO_LABEL } from '@/lib/movimientos/lotes';
import { formatFechaHora, formatMoney } from '@/lib/format';
import { UploadZone } from '@/components/upload-zone';
import { PageHeader } from '@/components/page-header';
import { CanalBadge } from '@/components/badges';
import { AutoRefresh } from '@/components/auto-refresh';

// Home: upload + pipeline status cards, always visible (UX spec: the user
// must always know how many vouchers are waiting on them).
export default async function CargaPage({ params }: { params: { empresaSlug: string } }) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  // Loaders only see their own uploads (permission table, doc 08)
  const filtroPropio = esValidador ? {} : { creadoPorId: ctx.usuario.id };
  const grupos = await ctx.db.movimiento.groupBy({
    by: ['estado'],
    where: filtroPropio,
    _count: { _all: true },
  });
  const conteo = Object.fromEntries(grupos.map((g) => [g.estado, g._count._all]));

  const tarjetas = [
    { estado: 'INGRESADO', label: 'Ingresados', acento: 'border-t-ink-mute/40' },
    { estado: 'PROCESANDO', label: 'Procesando', acento: 'border-t-sky-400' },
    { estado: 'PENDIENTE_VALIDACION', label: 'Pendientes de validación', acento: 'border-t-amber-400' },
    { estado: 'RETENIDO', label: 'Retenidos (mes cerrado)', acento: 'border-t-orange-400' },
    { estado: 'OBSERVADO', label: 'Observados', acento: 'border-t-violet-400' },
    { estado: 'DUPLICADO', label: 'Duplicados', acento: 'border-t-slate-400' },
    { estado: 'ERROR_PROCESAMIENTO', label: 'Errores', acento: 'border-t-red-400' },
    { estado: 'NO_COMPROBANTE', label: 'No comprobantes', acento: 'border-t-slate-300' },
  ];

  // Historial de lotes: cada drop web / mail / mensaje de Telegram, con su
  // progreso y resultados derivados de los movimientos (nada materializado).
  const lotes = await ctx.db.loteIngesta.findMany({
    where: esValidador ? {} : { creadoPorId: ctx.usuario.id },
    include: {
      creadoPor: { select: { nombre: true } },
      // Lo necesario para el desplegable: qué comprobante es y a dónde fue.
      movimientos: {
        select: {
          id: true,
          estado: true,
          flags: true,
          archivoNombre: true,
          descripcion: true,
          tipoComprobante: true,
          puntoVenta: true,
          numero: true,
          total: true,
          moneda: true,
          contraparte: { select: { razonSocial: true } },
          categoria: { select: { nombre: true } },
          lineas: {
            select: {
              id: true,
              porcentaje: true,
              centroCosto: { select: { nombre: true } },
              cliente: { select: { nombre: true } },
              proyecto: { select: { nombre: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  // Qué hizo el pipeline solo (AUTO_VALIDAR / AUTO_ASIGNAR en la auditoría)
  // vs. lo que después validó o asignó una persona.
  const autos = await ctx.db.auditLog.findMany({
    where: {
      entidad: 'Movimiento',
      accion: { in: ['AUTO_VALIDAR', 'AUTO_ASIGNAR'] },
      entidadId: { in: lotes.flatMap((l) => l.movimientos.map((m) => m.id)) },
    },
    select: { entidadId: true, accion: true },
  });
  const autoDe = new Map(autos.map((a) => [a.entidadId, a.accion as 'AUTO_VALIDAR' | 'AUTO_ASIGNAR']));
  const ahora = Date.now();
  const conResumen = lotes.map((l) => {
    const movimientos = l.movimientos.map((m) => ({ ...m, auto: autoDe.get(m.id) ?? null }));
    const resumen = resumirLote(movimientos);
    return { lote: { ...l, movimientos }, resumen, ...estadoLote(l, resumen, ahora) };
  });
  const hayEnCurso = conResumen.some((x) => x.enCurso);

  const destino = (estado: string) =>
    esValidador && !['INGRESADO', 'PROCESANDO'].includes(estado)
      ? `/${params.empresaSlug}/validacion?estado=${estado}`
      : `/${params.empresaSlug}/comprobantes?estado=${estado}`;

  return (
    <div>
      <PageHeader
        titulo="Carga de comprobantes"
        descripcion="Arrastrá facturas en PDF o foto y el pipeline hace el resto: OCR, checks, ARCA y cola de validación."
      />

      <div className="reveal reveal-2">
        <UploadZone empresaSlug={params.empresaSlug} />
      </div>

      <div className="reveal reveal-3 mt-8">
        <h2 className="label !text-[12px] mb-3">Estado del pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
          {tarjetas.map((t) => (
            <Link
              key={t.estado}
              href={destino(t.estado)}
              className={`card border-t-[3px] ${t.acento} p-4 transition-all hover:shadow-lift hover:-translate-y-0.5`}
            >
              <p className="font-mono text-[26px] font-semibold leading-none tabular-nums">{conteo[t.estado] ?? 0}</p>
              <p className="mt-2 text-[11.5px] text-ink-mute leading-tight">{t.label}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-mute/80">
          Los comprobantes también entran por <strong>email</strong> y <strong>Telegram</strong> (Configuración →
          canales). El worker (<code className="rounded bg-line/50 px-1 font-mono text-[11px]">npm run worker</code>)
          tiene que estar corriendo para procesarlos.
        </p>
      </div>

      <div className="reveal reveal-4 mt-8">
        <AutoRefresh activo={hayEnCurso} />
        <h2 className="label !text-[12px] mb-3">Procesamientos</h2>
        {conResumen.length === 0 ? (
          <p className="text-sm text-ink-mute">Todavía no hay lotes: subí comprobantes y acá vas a ver cómo terminó cada tanda.</p>
        ) : (
          <div className="card divide-y divide-line/60">
            {conResumen.map(({ lote, resumen, enCurso, sinIngresar }) => {
              // Mientras suben las tandas la barra apunta a lo declarado; si algo
              // no llegó, a lo que realmente entró (y el faltante va aparte).
              const esperado = Math.max(enCurso && sinIngresar === 0 ? lote.archivos : resumen.total, resumen.total, 1);
              const completados = resumen.total - resumen.enProceso;
              const pct = Math.round((completados / esperado) * 100);
              return (
                <details key={lote.id} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="text-ink-mute text-xs transition-transform group-open:rotate-90" aria-hidden>▸</span>
                    <span className="whitespace-nowrap text-ink-mute">{formatFechaHora(lote.createdAt)}</span>
                    <CanalBadge canal={lote.canal} />
                    <span className="text-ink-mute text-xs">
                      {lote.creadoPor?.nombre ?? lote.origenDetalle ?? '—'}
                      {lote.creadoPor && lote.origenDetalle ? ` · ${lote.origenDetalle}` : ''}
                    </span>
                    <span className="font-medium tabular-nums">
                      {esperado} comprobante{esperado !== 1 ? 's' : ''}
                    </span>
                    {enCurso && (
                      <span className="text-xs text-sky-700 tabular-nums">procesando {completados}/{esperado}…</span>
                    )}
                    {sinIngresar > 0 && (
                      <span
                        title={`Se declararon ${lote.archivos} archivos y entraron ${resumen.total}: el resto no llegó al servidor (o se borró después). Si no llegaron, volvé a subirlos: los repetidos quedan como duplicados.`}
                        className="cursor-help inline-block rounded bg-red-100 text-red-800 px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
                      >
                        {sinIngresar} sin ingresar
                      </span>
                    )}
                  </div>
                  {enCurso ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                      <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {resumen.resultados.map((r) => (
                        <span
                          key={r.clave}
                          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_CLASES[r.clave] ?? 'bg-line/50 text-ink-mute'}`}
                        >
                          {r.cantidad} {RESULTADO_LABEL[r.clave]}
                        </span>
                      ))}
                      {resumen.total === 0 && <span className="text-xs text-ink-mute">sin comprobantes ingresados</span>}
                    </div>
                  )}
                  </summary>
                  {lote.movimientos.length > 0 && (
                    <DetalleLote
                      movimientos={lote.movimientos}
                      empresaSlug={params.empresaSlug}
                      conLink={esValidador}
                    />
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type MovimientoDetalle = {
  id: string;
  estado: string;
  flags: unknown;
  archivoNombre: string | null;
  descripcion: string | null;
  tipoComprobante: string | null;
  puntoVenta: string | null;
  numero: string | null;
  total: unknown;
  moneda: string;
  auto: 'AUTO_VALIDAR' | 'AUTO_ASIGNAR' | null;
  contraparte: { razonSocial: string } | null;
  categoria: { nombre: string } | null;
  lineas: {
    id: string;
    porcentaje: unknown;
    centroCosto: { nombre: string };
    cliente: { nombre: string } | null;
    proyecto: { nombre: string } | null;
  }[];
};

// Desplegable de un lote: cada comprobante con su resultado y, si quedó
// asignado, a qué centro / cliente / proyecto (y categoría) fue. Clickeable
// para validadores (el detalle pide ese rol).
function DetalleLote({
  movimientos,
  empresaSlug,
  conLink,
}: {
  movimientos: MovimientoDetalle[];
  empresaSlug: string;
  conLink: boolean;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-ink-mute">
            <th className="py-1 pr-3 font-normal">Comprobante</th>
            <th className="py-1 pr-3 font-normal">Resultado</th>
            <th className="py-1 pr-3 font-normal">Categoría</th>
            <th className="py-1 pr-3 font-normal">Asignado a</th>
            <th className="py-1 font-normal text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/40">
          {detalleLote(movimientos).map(({ mov: m, clave }) => {
            const nombre = m.contraparte?.razonSocial ?? m.descripcion ?? m.archivoNombre ?? 'Sin datos';
            const numero = m.numero
              ? `${m.tipoComprobante?.replace(/_/g, ' ') ?? ''} ${m.puntoVenta ? `${m.puntoVenta}-` : ''}${m.numero}`.trim()
              : null;
            return (
              <tr key={m.id} className="align-top">
                <td className="py-1.5 pr-3">
                  {conLink ? (
                    <Link href={`/${empresaSlug}/validacion/${m.id}`} className="font-medium underline-offset-2 hover:underline">
                      {nombre}
                    </Link>
                  ) : (
                    <span className="font-medium">{nombre}</span>
                  )}
                  {numero && <span className="block font-mono text-[11.5px] text-ink-mute">{numero}</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {clave ? (
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_CLASES[clave] ?? 'bg-line/50 text-ink-mute'}`}>
                      {RESULTADO_SINGULAR[clave] ?? RESULTADO_LABEL[clave]}
                    </span>
                  ) : (
                    <span className="text-[11px] text-sky-700">procesando…</span>
                  )}
                  {clave === 'asignados' && m.auto === 'AUTO_VALIDAR' && (
                    <span className="block text-[10.5px] text-ink-mute">auto-validado</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-ink-mute">{m.categoria?.nombre ?? '—'}</td>
                <td className="py-1.5 pr-3 text-ink-mute">
                  {m.lineas.length === 0
                    ? '—'
                    : m.lineas.map((l) => (
                        <span key={l.id} className="block">
                          {l.centroCosto.nombre}
                          {l.cliente ? ` / ${l.cliente.nombre}` : ''}
                          {l.proyecto ? ` / ${l.proyecto.nombre}` : ''}
                          {Number(l.porcentaje) !== 100 && (
                            <span className="tabular-nums"> · {Number(l.porcentaje).toLocaleString('es-AR')}%</span>
                          )}
                        </span>
                      ))}
                </td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                  {m.total == null
                    ? '—'
                    : m.moneda !== 'ARS'
                      ? `${m.moneda} ${formatMoney(Number(m.total)).replace('$ ', '')}`
                      : formatMoney(Number(m.total))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Etiqueta de un único comprobante (los chips del resumen van en plural).
const RESULTADO_SINGULAR: Record<string, string> = {
  pendientes: 'pendiente de validación',
  'auto-validados': 'auto-validado',
  'auto-asignados': 'auto-asignado',
  validados: 'validado a mano',
  asignados: 'asignado a mano',
  observados: 'observado',
  retenidos: 'retenido',
  duplicados: 'duplicado',
  errores: 'error',
  'no-comprobantes': 'no es comprobante',
  anulados: 'anulado',
};

// Colores de los chips de resultado, alineados con los acentos de las tarjetas.
const CHIP_CLASES: Record<string, string> = {
  pendientes: 'bg-amber-100 text-amber-800',
  'auto-validados': 'bg-emerald-100 text-emerald-800',
  'auto-asignados': 'bg-emerald-200 text-emerald-900',
  validados: 'bg-sky-100 text-sky-800',
  asignados: 'bg-sky-200 text-sky-900',
  observados: 'bg-violet-100 text-violet-800',
  retenidos: 'bg-orange-100 text-orange-800',
  'archivo-duplicado': 'bg-slate-200 text-slate-700',
  duplicados: 'bg-slate-100 text-slate-600',
  errores: 'bg-red-100 text-red-800',
  anulados: 'bg-line/50 text-ink-mute',
};
