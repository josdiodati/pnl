import Link from 'next/link';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { PageHeader } from '@/components/page-header';
import { ErrorBanner } from '@/components/error-banner';
import { RegistrarCobroForm, type FacturaForm } from '@/components/registrar-cobro-form';
import { cargarVentas, facturasParaReparto } from '@/lib/cobranzas/service';
import { esCobrable } from '@/lib/cobranzas/estado';
import { hoyUtc } from '@/lib/cobranzas/query';
import { isDomainError } from '@/lib/errors';

// Registrar un cobro de una o varias ventas (llegan tildadas desde la tabla de
// Ventas, o desde la cobranza de una factura).

export default async function RegistrarCobroPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { ids?: string | string[]; volver?: string; error?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'VALIDADOR');
  const ids = [...new Set(([] as string[]).concat(searchParams.ids ?? []).filter(Boolean))];
  const volver = searchParams.volver || 'ventas';
  const qs = `${ids.map((i) => `ids=${encodeURIComponent(i)}`).join('&')}&volver=${encodeURIComponent(volver)}`;

  let problema: string | null = null;
  let facturas: FacturaForm[] = [];
  if (ids.length === 0) problema = 'Tildá una o varias facturas en la tabla de Ventas para registrar su cobro.';
  else {
    try {
      const ventas = await cargarVentas(ctx.db, ids);
      const conSaldo = facturasParaReparto(ventas).filter((f) => esCobrable(f.cobrable) && f.saldo > 0);
      const porId = new Map(ventas.map((v) => [v.id, v]));
      facturas = conSaldo.map((f) => {
        const v = porId.get(f.id)!;
        return {
          id: f.id,
          etiqueta: `${v.tipoComprobante?.replace(/_/g, ' ') ?? 'Venta'} ${v.puntoVenta ? `${v.puntoVenta}-` : ''}${v.numero ?? ''}`.trim(),
          cliente: v.contraparte?.razonSocial ?? v.descripcion ?? '—',
          fechaIso: (v.fechaDevengamiento ?? v.createdAt).toISOString().slice(0, 10),
          saldo: f.saldo,
          moneda: f.moneda,
          tcFactura: f.tcFactura,
        };
      }).sort((a, b) => a.fechaIso.localeCompare(b.fechaIso));
      if (facturas.length === 0) problema = 'Las facturas elegidas ya están cobradas o no son cobrables.';
      else if (new Set(facturas.map((f) => f.moneda)).size > 1) {
        problema = 'Las facturas elegidas son de monedas distintas: registrá un cobro por moneda.';
      }
    } catch (err) {
      if (!isDomainError(err)) throw err;
      problema = err.message;
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Registrar cobro"
        descripcion="Uno o varios instrumentos (transferencia, cheques, retenciones) aplicados a las facturas elegidas, empezando por la más vieja. El cobro no toca el P&L; cuando llegue el resumen del banco, la línea lo confirma."
        acciones={<Link href={`/${params.empresaSlug}/${volver}`} className="btn-secondary">Volver</Link>}
      />
      <ErrorBanner mensaje={searchParams.error} />
      {problema ? (
        <div className="card p-6 text-[13px] text-ink-mute">{problema}</div>
      ) : (
        <RegistrarCobroForm
          slug={params.empresaSlug}
          facturas={facturas}
          hoyIso={hoyUtc().toISOString().slice(0, 10)}
          volver={volver}
          errorEn={`ventas/cobro?${qs}`}
        />
      )}
    </div>
  );
}
