// "Fecha de Vto. para el pago" de una factura, leída del texto del documento
// (respaldo determinístico de la extracción y backfill de ventas existentes).
// El facturador de ARCA imprime los rótulos del encabezado primero y los
// valores después: "Período Facturado Desde: Hasta: Fecha de Vto. para el
// pago: … dd/mm/aaaa dd/mm/aaaa dd/mm/aaaa" → la tercera fecha. Si el rótulo
// va seguido de su fecha, se toma esa. Cualquier otro formato: null.

const FECHA = /(\d{2})\/(\d{2})\/(\d{4})/g;

function aIso(dd: string, mm: string, aaaa: string): string | null {
  const d = Number(dd), m = Number(mm), a = Number(aaaa);
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${aaaa}-${mm}-${dd}`;
}

export function vencimientoPagoDesdeTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.replace(/\s+/g, ' ');
  const rotulo = /Fecha de Vto\.? para el pago:\s*/i.exec(t);
  if (!rotulo) return null;
  const resto = t.slice(rotulo.index + rotulo[0].length);

  const inmediata = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(resto);
  if (inmediata) return aIso(inmediata[1], inmediata[2], inmediata[3]);

  const conPeriodo = /Per[ií]odo Facturado Desde:\s*Hasta:\s*$/i.test(t.slice(0, rotulo.index));
  if (!conPeriodo) return null;
  const fechas = [...resto.slice(0, 600).matchAll(FECHA)];
  const tercera = fechas[2];
  return tercera ? aIso(tercera[1], tercera[2], tercera[3]) : null;
}
