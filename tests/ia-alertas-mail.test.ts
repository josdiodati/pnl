import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';

// Las alertas de IA son de la aplicación: van por mail al owner (APP_OWNER_EMAIL).

const enviarEmail = vi.fn();
vi.mock('@/lib/canales/resend', () => ({ enviarEmail, resendHabilitado: () => true }));
const { registrarFalloJob, resolverAlertasIa, alertasIaActivas } = await import('@/lib/ia/alertas');

const sinCredito = () =>
  Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, undefined, { 'request-id': 'req_mail' } as never);
const jobs: string[] = [];
async function jobEnProceso() {
  const j = await enqueueJob('EXTRACCION', { test: 'ia-alertas-mail' });
  jobs.push(j.id);
  return prisma.job.update({ where: { id: j.id }, data: { estado: 'processing', intentos: 1 } });
}

beforeEach(async () => {
  enviarEmail.mockReset();
  process.env.APP_OWNER_EMAIL = 'owner@test.local';
  await prisma.alertaSistema.deleteMany({ where: { origen: 'IA' } });
});
afterAll(async () => {
  delete process.env.APP_OWNER_EMAIL;
  await prisma.alertaSistema.deleteMany({ where: { origen: 'IA' } });
  await prisma.job.deleteMany({ where: { id: { in: jobs } } });
});

describe('alertas de IA por mail al owner', () => {
  it('una alerta nueva manda un mail al owner con el código en el asunto', async () => {
    enviarEmail.mockResolvedValue(undefined);
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    expect(enviarEmail).toHaveBeenCalledOnce();
    const m = enviarEmail.mock.calls[0][0];
    expect(m.to).toEqual(['owner@test.local']);
    expect(m.subject).toMatch(/SIN_CREDITO/);
    expect(m.text).toMatch(/console\.anthropic\.com/);
    expect(m.text).toContain('req_mail');
  });

  it('la misma alerta repetida no vuelve a mandar mail', async () => {
    enviarEmail.mockResolvedValue(undefined);
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    expect(enviarEmail).toHaveBeenCalledOnce();
  });

  it('si el mail falla, la alerta queda registrada igual', async () => {
    enviarEmail.mockRejectedValue(new Error('Resend 500'));
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    expect((await alertasIaActivas())[0].codigo).toBe('SIN_CREDITO');
  });

  it('al resolverse avisa por mail', async () => {
    enviarEmail.mockResolvedValue(undefined);
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    await resolverAlertasIa();
    expect(enviarEmail).toHaveBeenCalledTimes(2);
    expect(enviarEmail.mock.calls[1][0].subject).toMatch(/volvió a funcionar/);
  });

  it('un error transitorio que va y viene no manda un par de mails por ciclo', async () => {
    enviarEmail.mockResolvedValue(undefined);
    const sobrecarga = () => Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, undefined, {} as never);
    const agotado = async () => prisma.job.update({ where: { id: (await jobEnProceso()).id }, data: { intentos: 3 } });
    await registrarFalloJob(await agotado(), sobrecarga()); // abre: mail
    await resolverAlertasIa(); // transitorio: sin mail de cierre
    await registrarFalloJob(await agotado(), sobrecarga()); // reabre dentro de la hora: sin mail
    expect(enviarEmail).toHaveBeenCalledOnce();
    expect((await alertasIaActivas())[0].codigo).toBe('API_SOBRECARGADA');
  });
});
