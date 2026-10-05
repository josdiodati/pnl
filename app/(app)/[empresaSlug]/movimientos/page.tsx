import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza } from '@/lib/roles';
import { aplicarEjercicio, buildWhereMovimientos, resumirMovimientos, totalFirmadoDe, tonoImporte, type FiltrosMovimientos } from '@/lib/movimientos/query';
import { resumirCostosPersonal } from '@/lib/empleados/costos';
import { formatMoney, formatMoneyFirmado, formatFecha } from '@/lib/format';
import { netoDe, netoFirmadoDe } from '@/lib/movimientos/neto';
import { CanalBadge } from '@/components/badges';
import { OkBanner } from '@/components/error-banner';
import { ejercicioDeMes, periodoDeFecha, MES_LABEL } from '@/lib/periodos';

// Minimal reporting view (doc 09): filterable table + selection totals +
// mini-summary with cost-center breakdown + XLSX export. No formatted P&L.
export default async function MovimientosPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: FiltrosMovimientos & { ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'CARGADOR');
  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');

  // Por defecto, el ejercicio corriente según el mes de inicio de la empresa.
  const inicioEjercicio = ctx.empresa.inicioEjercicioFiscal;
  const { filtros: f, ejercicio, ejercicioCorriente } = aplicarEjercicio(searchParams, inicioEjercicio);
  const where = buildWhereMovimientos(f, { esValidador, usuarioId: ctx.usuario.id });
  const [movimientos, categorias, centros, clientes, proyectos, contrapartes, primero] = await Promise.all([
    ctx.db.movimiento.findMany({
      where,
      include: { categoria: true, contraparte: true, lineas: true, vinculosEmpleados: { select: { monto: true } } },
      orderBy: [{ fechaDevengamiento: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    }),
    ctx.db.categoria.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.centroCosto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.cliente.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.proyecto.findMany({ orderBy: { nombre: 'asc' } }),
    ctx.db.contraparte.findMany({ orderBy: { razonSocial: 'asc' } }),
    ctx.db.movimiento.findFirst({
      where: { fechaDevengamiento: { not: null } },
      orderBy: { fechaDevengamiento: 'asc' },
      select: { fechaDevengamiento: true },
    }),
  ]);

  // Opciones del selector: del ejercicio del primer movimiento al corriente.
  const ejercicioMasViejo = primero?.fechaDevengamiento
    ? (({ anio, mes }) => ejercicioDeMes(anio, mes, inicioEjercicio))(periodoDeFecha(primero.fechaDevengamiento))
    : ejercicioCorriente;
  const ejercicios = Array.from(
    new Set([ejercicioCorriente, ...(ejercicio != null ? [ejercicio] : [])]),
  );
  for (let a = ejercicioCorriente - 1; a >= ejercicioMasViejo; a--) if (!ejercicios.includes(a)) ejercicios.push(a);
  ejercicios.sort((a, b) => b - a);
  const etiquetaEjercicio = (a: number) =>
    inicioEjercicio === 1 ? String(a) : `${a}/${String(a + 1).slice(2)} (${MES_LABEL[inicioEjercicio].slice(0, 3).toLowerCase()} ${a})`;

  const resumen = resumirMovimientos(movimientos as never);

  // Costos de personal del rango: recibos CONFIRMADOS cuyos períodos caen en
  // [desde, hasta] (por mes) + porciones vinculadas de los movimientos listados.
  const recibosConfirmados = await ctx.db.reciboSueldo.findMany({
    where: { estado: 'CONFIRMADO' },
    include: { periodo: true, lineas: true },
  });
  const dentroDelRango = (anio: number, mes: number) => {
    const clave = anio * 100 + mes;
    const desde = f.desde ? Number(f.desde.slice(0, 7).replace('-', '')) : null;
    const hasta = f.hasta ? Number(f.hasta.slice(0, 7).replace('-', '')) : null;
    return (desde == null || clave >= desde) && (hasta == null || clave <= hasta);
  };
  const vinculosDeSeleccion = await ctx.db.movimientoEmpleado.findMany({
    where: { movimientoId: { in: movimientos.map((m) => m.id) } },
    include: { empleado: { include: { distribucion: true } } },
  });
  // Movimientos de categorías "de costo de personal" (ej. Prepagas): computan
  // acá y NO en el resumen general (resumirMovimientos ya los excluye). Si un
  // movimiento de estas categorías tuviera vínculos, se ignoran: el movimiento
  // entero ya entra al bloque.
  const idsPersonal = new Set(
    movimientos.filter((m) => m.categoria?.esCostoPersonal && m.estado === 'ASIGNADO').map((m) => m.id),
  );
  const resumenPersonal = resumirCostosPersonal(
    recibosConfirmados
      .filter((r) => dentroDelRango(r.periodo.anio, r.periodo.mes))
      .map((r) => ({ costoTotalEmpleador: r.costoTotalEmpleador, lineas: r.lineas })),
    vinculosDeSeleccion
      .filter((v) => !idsPersonal.has(v.movimientoId))
      .map((v) => ({ monto: v.monto, lineasEmpleado: v.empleado.distribucion })),
    movimientos
      .filter((m) => idsPersonal.has(m.id))
      .map((m) => ({
        firmadoCentavos: totalFirmadoDe(m as never) ?? 0,
        lineas: m.lineas.map((l) => ({
          centroCostoId: l.centroCostoId,
          clienteId: l.clienteId ?? null,
          proyectoId: (l as { proyectoId?: string | null }).proyectoId ?? null,
          porcentaje: l.porcentaje,
        })),
      })),
  );
  // Si se filtra por centro de costo, cliente o proyecto, el bloque muestra sólo
  // esa porción. 'sin' (proyecto) = lo no atribuido a ningún proyecto.
  const personalSinProyecto =
    resumenPersonal.total - [...resumenPersonal.porProyecto.values()].reduce((a, v) => a + v, 0);
  const personalMostrado = searchParams.centroCostoId
    ? resumenPersonal.porCentroCosto.get(searchParams.centroCostoId) ?? 0
    : searchParams.clienteId
      ? resumenPersonal.porCliente.get(searchParams.clienteId) ?? 0
      : searchParams.proyectoId
        ? searchParams.proyectoId === 'sin'
          ? personalSinProyecto
          : resumenPersonal.porProyecto.get(searchParams.proyectoId) ?? 0
        : resumenPersonal.total;
  const sinFiltroDePersonal = !searchParams.centroCostoId && !searchParams.clienteId && !searchParams.proyectoId;

  const egresosConPersonal = resumen.egresos + personalMostrado;
  const resultadoConPersonal = resumen.resultado + personalMostrado;
  // Resultado por centro con su costo de personal. Con filtro de cliente o
  // proyecto el personal no se puede abrir por centro: no se muestra el detalle.
  const porCentroConPersonal = new Map(resumen.porCentroCosto);
  if (sinFiltroDePersonal) {
    for (const [ccId, total] of resumenPersonal.porCentroCosto) {
      porCentroConPersonal.set(ccId, (porCentroConPersonal.get(ccId) ?? 0) + total);
    }
  } else if (searchParams.centroCostoId) {
    porCentroConPersonal.set(
      searchParams.centroCostoId,
      (porCentroConPersonal.get(searchParams.centroCostoId) ?? 0) + personalMostrado,
    );
  }
  const resultadoPorCentro =
    sinFiltroDePersonal || searchParams.centroCostoId
      ? [...porCentroConPersonal.entries()].sort((a, b) => b[1] - a[1])
      : [];

  const qs = new URLSearchParams(
    Object.entries(searchParams).filter(([k, v]) => v && k !== 'ok') as [string, string][],
  ).toString();

  const filtros: { name: keyof FiltrosMovimientos; label: string; opciones: { id: string; nombre: string }[] }[] = [
    { name: 'categoriaId', label: 'Categoría', opciones: categorias.map((c) => ({ id: c.id, nombre: `${c.nombre} (${c.tipo})` })) },
    { name: 'centroCostoId', label: 'Centro de costo', opciones: centros.map((c) => ({ id: c.id, nombre: c.nombre })) },
    {
      name: 'clienteId',
      label: 'Cliente',
      opciones: [{ id: 'sin', nombre: '— Sin cliente —' }, ...clientes.map((c) => ({ id: c.id, nombre: c.nombre }))],
    },
    {
      name: 'proyectoId',
      label: 'Proyecto',
      opciones: [{ id: 'sin', nombre: '— Sin proyecto —' }, ...proyectos.map((p) => ({ id: p.id, nombre: p.nombre }))],
    },
    { name: 'contraparteId', label: 'Contraparte', opciones: contrapartes.map((c) => ({ id: c.id, nombre: c.razonSocial })) },
  ];

  // Neto de la selección (mismo signo y pesificación que el total de cada fila).
  const netoSeleccion = movimientos.reduce((acc, m) => acc + (netoFirmadoDe(totalFirmadoDe(m as never), m) ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Movimientos</h1>
          <p className="text-xs text-slate-500">Libro de movimientos asignados: lo que impacta el resultado. Lo validado sin imputar está en la cola de Asignación.</p>
        </div>
        <a href={`/${params.empresaSlug}/movimientos/export${qs ? `?${qs}` : ''}`} className="btn-secondary text-sm">
          Exportar Excel
        </a>
      </div>
      <OkBanner mensaje={searchParams.ok} />

      {/* Mini-summary over the validated movements of the selection, con los costos de personal incluidos */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-3 min-w-0">
          <p className="text-xs text-slate-500">Ingresos (asignados)</p>
          <p className="text-xl font-semibold tabular-nums text-emerald-700">{formatMoneyFirmado(resumen.ingresos)}</p>
        </div>
        <div className="card p-3 min-w-0">
          <p className="text-xs text-slate-500">Egresos (asignados + personal)</p>
          <p className="text-xl font-semibold tabular-nums text-red-700">{formatMoneyFirmado(egresosConPersonal)}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Incluye costos de personal: <span className="tabular-nums">{formatMoneyFirmado(personalMostrado)}</span>
          </p>
        </div>
        <div className="card p-3 min-w-0">
          <p className="text-xs text-slate-500">Resultado</p>
          <p className={`text-xl font-semibold tabular-nums ${resultadoConPersonal >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {formatMoneyFirmado(resultadoConPersonal)}
          </p>
          {resultadoPorCentro.length > 0 && (
            <ul className="text-[11px] text-slate-500 mt-1 space-y-0.5">
              {resultadoPorCentro.map(([ccId, total]) => (
                <li key={ccId} className="flex justify-between gap-2">
                  <span className="truncate">{centros.find((c) => c.id === ccId)?.nombre ?? '?'}</span>
                  <span className="tabular-nums whitespace-nowrap">{formatMoneyFirmado(total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <form method="get" className="card p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
        <div className="col-span-2">
          <label className="label">Buscar</label>
          <input
            type="search"
            name="q"
            defaultValue={searchParams.q ?? ''}
            className="input text-xs"
            placeholder="contraparte, descripción, número, CUIT, archivo…"
          />
        </div>
        <div>
          <label className="label" title="Ejercicio fiscal según el mes de inicio de la empresa. Si además elegís fechas, se aplican dentro del ejercicio.">Ejercicio</label>
          <select name="ejercicio" defaultValue={ejercicio != null ? String(ejercicio) : 'todos'} className="input text-xs">
            {ejercicios.map((a) => (
              <option key={a} value={a}>{etiquetaEjercicio(a)}{a === ejercicioCorriente ? ' · corriente' : ''}</option>
            ))}
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label className="label">Desde</label>
          <input type="date" name="desde" defaultValue={searchParams.desde} className="input text-xs" />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input type="date" name="hasta" defaultValue={searchParams.hasta} className="input text-xs" />
        </div>
        {filtros.map((f) => (
          <div key={f.name}>
            <label className="label">{f.label}</label>
            <select name={f.name} defaultValue={searchParams[f.name] ?? ''} className="input text-xs">
              <option value="">Todos</option>
              {f.opciones.map((o) => (
                <option key={o.id} value={o.id}>{o.nombre}</option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <label className="label">Origen</label>
          <select name="origen" defaultValue={searchParams.origen ?? ''} className="input text-xs">
            <option value="">Todos</option>
            <option value="COMPROBANTE">Comprobante</option>
            <option value="ASIENTO_MANUAL">Asiento manual</option>
            <option value="VENTA_MANUAL">Venta manual</option>
            <option value="RESUMEN">Resumen bancario</option>
          </select>
        </div>
        <div>
          <label className="label" title="Movimientos de categorías marcadas «es impuesto indirecto» (IVA, IIBB, Sircreb, Imp. Cheque…): en el Reporte P&L van al memo de impuestos, no al resultado">Impuestos (memo)</label>
          <select name="impuestos" defaultValue={searchParams.impuestos ?? ''} className="input text-xs">
            <option value="">Ocultar</option>
            <option value="incluir">Incluir</option>
            <option value="solo">Sólo impuestos</option>
          </select>
        </div>
        <div className="flex gap-1">
          <button className="btn-primary text-xs">Filtrar</button>
          <Link href={`/${params.empresaSlug}/movimientos`} className="btn-secondary text-xs">Limpiar</Link>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Descripción / contraparte</th>
              <th>Comprobante</th>
              <th>Categoría</th>
              <th>Asignación</th>
              <th>Origen</th>
              <th>Canal</th>
              <th className="text-right" title="Sin IVA, percepciones ni otros tributos">Neto</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              const firmado = totalFirmadoDe(m as never);
              const netoFirmado = netoFirmadoDe(firmado, m);
              const tono = { 'sin-signo': 'text-slate-400', egreso: 'text-red-700', ingreso: 'text-emerald-700' }[tonoImporte(firmado)];
              return (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap">{formatFecha(m.fechaDevengamiento)}</td>
                  <td>
                    <Link href={`/${params.empresaSlug}/validacion/${m.id}`} className="hover:underline">
                      <span className="font-medium">{m.contraparte?.razonSocial ?? m.descripcion ?? 'Sin descripción'}</span>
                      {m.contraparte && m.descripcion && <span className="text-slate-500"> — {m.descripcion}</span>}
                    </Link>
                    {(m.vinculosEmpleados?.length ?? 0) > 0 && (
                      <span className="text-[10px] text-slate-400 ml-1">· vinculado a empleados</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12.5px] text-slate-600">
                    {m.numero ? (
                      <>
                        {m.tipoComprobante?.replace(/_/g, ' ')} {m.puntoVenta ? `${m.puntoVenta}-` : ''}{m.numero}
                      </>
                    ) : '—'}
                  </td>
                  <td>{m.categoria?.nombre ?? '—'}</td>
                  <td className="text-xs text-slate-500">
                    {m.lineas.map((l, i) => (
                      <span key={l.id}>
                        {i > 0 && ' · '}
                        {centros.find((c) => c.id === l.centroCostoId)?.nombre ?? '?'}
                        {l.clienteId ? `/${clientes.find((c) => c.id === l.clienteId)?.nombre ?? '?'}` : ''}
                        {l.proyectoId ? `/${proyectos.find((p) => p.id === l.proyectoId)?.nombre ?? '?'}` : ''}{' '}
                        {Number(l.porcentaje).toLocaleString('es-AR')}%
                      </span>
                    ))}
                  </td>
                  <td className="text-xs text-slate-500 whitespace-nowrap">
                    {m.origen === 'COMPROBANTE' ? 'Comprobante' : m.origen === 'ASIENTO_MANUAL' ? 'Asiento' : m.origen === 'RESUMEN' ? 'Resumen' : 'Venta'}
                  </td>
                  <td><CanalBadge canal={m.canalIngreso} /></td>
                  <td className={`num ${tono}`} title={firmado == null ? 'Sin categoría: el signo se define al imputarlo' : undefined}>
                    {netoFirmado != null ? formatMoneyFirmado(netoFirmado) : formatMoney(netoDe(m))}
                  </td>
                  <td
                    className={`num font-medium ${tono}`}
                    title={firmado == null ? 'Sin categoría: el signo se define al imputarlo' : undefined}
                  >
                    {firmado != null ? formatMoneyFirmado(firmado) : formatMoney(m.total ? Number(m.total) : null)}
                    {firmado == null && <span className="ml-1 text-[10px] font-normal">sin imputar</span>}
                    {m.moneda !== 'ARS' && (
                      <span className="block text-[10px] font-normal text-slate-400">
                        {m.moneda} {formatMoney(m.total ? Number(m.total) : null)}
                        {m.tipoCambio != null ? ` · TC ${Number(m.tipoCambio).toLocaleString('es-AR')}` : ' · sin TC'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-8">Sin movimientos para los filtros elegidos</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td colSpan={7} className="text-right text-sm text-slate-500">
                Total de la selección ({movimientos.length} mov.):
              </td>
              <td className={`num ${netoSeleccion < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {formatMoneyFirmado(netoSeleccion)}
              </td>
              <td className={`num ${resumen.resultado < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {formatMoneyFirmado(resumen.resultado)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {movimientos.length === 500 && (
        <p className="text-xs text-amber-600">Se muestran los primeros 500 movimientos; afiná los filtros o usá el export a Excel.</p>
      )}
    </div>
  );
}
