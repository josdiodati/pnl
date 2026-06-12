// Voucher date sanity: not in the future, not older than 5 years.

export function checkFecha(fecha: Date | string | null | undefined, hoy: Date = new Date()): {
  ok: boolean;
  motivo?: string;
} {
  if (!fecha) return { ok: false, motivo: 'Sin fecha' };
  const f = typeof fecha === 'string' ? new Date(`${fecha}T00:00:00`) : fecha;
  if (Number.isNaN(f.getTime())) return { ok: false, motivo: 'Fecha inválida' };
  const finDeHoy = new Date(hoy);
  finDeHoy.setHours(23, 59, 59, 999);
  if (f.getTime() > finDeHoy.getTime()) return { ok: false, motivo: 'Fecha futura' };
  const cincoAnios = new Date(hoy);
  cincoAnios.setFullYear(cincoAnios.getFullYear() - 5);
  if (f.getTime() < cincoAnios.getTime()) return { ok: false, motivo: 'Más de 5 años de antigüedad' };
  return { ok: true };
}
