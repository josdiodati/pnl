import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invitaciones por mail: el invitado recibe el enlace absoluto a
// /invitacion/<token>; sin Resend (o si falla) se informa para copiarlo a mano.

const enviarEmail = vi.fn();
let habilitado = true;
vi.mock('@/lib/canales/resend', () => ({ enviarEmail, resendHabilitado: () => habilitado }));
const { enlaceInvitacion, mailInvitacion, enviarInvitacion } = await import('@/lib/invitaciones');

const base = {
  email: 'nuevo@test.local',
  rol: 'VALIDADOR' as const,
  token: 'abc123',
  empresa: 'Kawellu SA',
  invitadoPor: 'José Diodati',
  cuentaExistente: false,
};

beforeEach(() => {
  enviarEmail.mockReset();
  habilitado = true;
  delete process.env.APP_URL;
});

describe('enlaceInvitacion', () => {
  it('arma el enlace absoluto con APP_URL o el dominio por defecto', () => {
    expect(enlaceInvitacion('abc123')).toBe('https://pnl.ledger.ar/invitacion/abc123');
    process.env.APP_URL = 'http://localhost:3000/';
    expect(enlaceInvitacion('abc123')).toBe('http://localhost:3000/invitacion/abc123');
  });
});

describe('mailInvitacion', () => {
  it('cuenta nueva: empresa, rol, quién invita, enlace y que tiene que crear la cuenta', () => {
    const m = mailInvitacion(base);
    expect(m.subject).toBe('Te invitaron a Kawellu SA en P&L Manager');
    expect(m.text).toContain('José Diodati');
    expect(m.text).toContain('Validador');
    expect(m.text).toContain('https://pnl.ledger.ar/invitacion/abc123');
    expect(m.text).toMatch(/elegí una contraseña/i);
  });

  it('cuenta existente: pide la contraseña actual', () => {
    const m = mailInvitacion({ ...base, cuentaExistente: true });
    expect(m.text).toMatch(/contraseña actual/i);
    expect(m.text).not.toMatch(/elegí una contraseña/i);
  });
});

describe('enviarInvitacion', () => {
  it('manda el mail al invitado', async () => {
    expect(await enviarInvitacion(base)).toEqual({ enviado: true });
    expect(enviarEmail).toHaveBeenCalledOnce();
    expect(enviarEmail.mock.calls[0][0].to).toEqual(['nuevo@test.local']);
  });

  it('sin Resend no manda y lo informa', async () => {
    habilitado = false;
    expect(await enviarInvitacion(base)).toEqual({ enviado: false, motivo: 'El envío de mails no está configurado.' });
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it('si Resend falla no lanza: devuelve el motivo', async () => {
    enviarEmail.mockRejectedValueOnce(new Error('Resend 422: invalid to'));
    const r = await enviarInvitacion(base);
    expect(r).toEqual({ enviado: false, motivo: expect.stringContaining('Resend 422') });
  });
});
