import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';
import { ErrorBanner } from '@/components/error-banner';
import { RegistrarCobroForm, type FacturaForm } from '@/components/registrar-cobro-form';
import { cargarVentas, facturasParaReparto, etiquetaVenta, motivoSoloDatos } from '@/lib/cobranzas/service';
import { hoyUtc } from '@/lib/cobranzas/query';

// Editar un cobro: el formulario de alta precargado. Las facturas son las
// mismas del cobro, con el saldo sin contarlo (para cambiar de facturas se
// elimina y se registra de nuevo).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const montoTxt = (n: number) => n.toFixed(2).replace('.', ',');

export default async function EditarCobroPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string; grupo: string };
  searchParams: { volver?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const cobros = await ctx.db.cobro.findMany({
    where: { grupo: params.grupo },
    include: { aplicaciones: true },
    orderBy: { createdAt: 'asc' },
  });
  if (cobros.length === 0) notFound();

  const volver = searchParams.volver || 'cobranzas';
  const detalle = `cobranzas/cobros/${params.grupo}?volver=${encodeURIComponent(volver)}`;
  const ventaIds = [...new Set(cobros.flatMap((c) => c.aplicaciones.map((a) => a.movimientoId)))];
  const ventas = await cargarVentas(ctx.db, ventaIds);
  const porId = new Map(ventas.map((v) => [v.id, v]));
  const facturas: FacturaForm[] = facturasParaReparto(ventas, params.grupo)
    .map((f) => {
      const v = porId.get(f.id)!;
      return {
        id: f.id,
        etiqueta: etiquetaVenta(v),
        cliente: v.contraparte?.razonSocial ?? v.descripcion ?? '—',
        fechaIso: iso(v.fechaDevengamiento ?? v.createdAt),
        saldo: f.saldo,
        moneda: f.moneda,
        tcFactura: f.tcFactura,
      };
    })
    .sort((a, b) => a.fechaIso.localeCompare(b.fechaIso));
  const cot = cobros.find((c) => c.tipoCambio != null)?.tipoCambio;

  return (
    <div>
      <PageHeader
        titulo="Editar cobro"
        descripcion="Cambiá montos, fechas, instrumentos, número, banco o nota. Si cambian los importes se recalcula a qué facturas se aplica; todo queda en el historial del cobro."
        acciones={<Link href={`/${params.empresaSlug}/${detalle}`} className="btn-secondary">Cancelar</Link>}
      />
      <ErrorBanner mensaje={searchParams.error} />
      <RegistrarCobroForm
        slug={params.empresaSlug}
        facturas={facturas}
        hoyIso={iso(hoyUtc())}
        volver={detalle}
        errorEn={`cobranzas/cobros/${params.grupo}/editar?volver=${encodeURIComponent(volver)}`}
        edicion={{
          grupo: params.grupo,
          filas: cobros.map((c) => ({
            cobroId: c.id,
            tipo: c.instrumento,
            monto: montoTxt(Number(c.monto)),
            moneda: c.moneda,
            fecha: iso(c.fecha),
            acreditacion: iso(c.fechaAcreditacion),
            numero: c.numero ?? '',
            banco: c.banco ?? '',
          })),
          cotizacion: cot != null ? String(Number(cot)).replace('.', ',') : '',
          nota: cobros[0].nota ?? '',
          soloDatos: motivoSoloDatos(cobros),
        }}
      />
    </div>
  );
}
