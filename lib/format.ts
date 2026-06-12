// Display formatters — es-AR conventions (1.234.567,89), tabular-friendly.

const moneyFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(valor: number | string | null | undefined): string {
  if (valor == null || valor === '') return '—';
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (Number.isNaN(n)) return '—';
  return `$ ${moneyFmt.format(n)}`;
}

export function formatMoneyFirmado(centavos: number): string {
  return `$ ${moneyFmt.format(centavos / 100)}`;
}

export function formatFecha(fecha: Date | string | null | undefined): string {
  if (!fecha) return '—';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function formatFechaHora(fecha: Date | string | null | undefined): string {
  if (!fecha) return '—';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fechaInputValue(fecha: Date | null | undefined): string {
  if (!fecha) return '';
  return fecha.toISOString().slice(0, 10);
}

export function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
