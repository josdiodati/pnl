import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { registrarFalloJob, resolverAlertasIa, alertasIaActivas, verificarConfiguracionIa, ESPERA_ERROR_GLOBAL_MS } from '@/lib/ia/alertas';

// Integración con la base: qué hace el worker con cada clase de error de la API.

const errorApi = (status: number, tipo: string, mensaje: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: tipo, message: mensaje } }, undefined, { 'request-id': 'req_test' } as never);
const sinCredito = () => errorApi(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.');

const jobsCreados: string[] = [];
async function jobEnProceso(tipo = 'EXTRACCION', intentos = 1) {
  const j = await enqueueJob(tipo as never, { test: 'ia-alertas' });
  jobsCreados.push(j.id);
  return prisma.job.update({ where: { id: j.id }, data: { estado: 'processing', intentos } });
}

beforeEach(async () => {
  await prisma.alertaSistema.deleteMany({ where: { origen: 'IA' } });
});
afterAll(async () => {
  await prisma.alertaSistema.deleteMany({ where: { origen: 'IA' } });
  await prisma.job.deleteMany({ where: { id: { in: jobsCreados } } });
});

describe('registrarFalloJob', () => {
  it('sin crédito: abre la alerta y deja el job en espera sin gastar el intento', async () => {
    const job = await jobEnProceso('EXTRACCION', 3); // último intento
    const antes = Date.now();
    const r = await registrarFalloJob(job, sinCredito());
    expect(r.final).toBe(false);
    expect(r.mensaje).toMatch(/^\[SIN_CREDITO\]/);

    const j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.estado).toBe('queued');
    expect(j.intentos).toBe(2);
    expect(j.proximoIntento!.getTime()).toBeGreaterThanOrEqual(antes + ESPERA_ERROR_GLOBAL_MS - 1000);

    const alertas = await alertasIaActivas();
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ codigo: 'SIN_CREDITO', ocurrencias: 1, requestId: 'req_test', enEspera: 1 });
  });

  it('el mismo error repetido suma ocurrencias en una sola alerta', async () => {
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    await registrarFalloJob(await jobEnProceso('EXTRACCION_RESUMEN'), sinCredito());
    const alertas = await alertasIaActivas();
    expect(alertas).toHaveLength(1);
    expect(alertas[0].ocurrencias).toBe(2);
  });

  it('sobrecarga: backoff normal y alerta sólo cuando se agotan los intentos', async () => {
    const r1 = await registrarFalloJob(await jobEnProceso('EXTRACCION', 1), errorApi(529, 'overloaded_error', 'Overloaded'));
    expect(r1.final).toBe(false);
    expect(await alertasIaActivas()).toHaveLength(0);

    const r3 = await registrarFalloJob(await jobEnProceso('EXTRACCION', 3), errorApi(529, 'overloaded_error', 'Overloaded'));
    expect(r3.final).toBe(true);
    expect(r3.mensaje).toMatch(/^\[API_SOBRECARGADA\]/);
    expect((await alertasIaActivas())[0].codigo).toBe('API_SOBRECARGADA');
  });

  it('documento rechazado: el documento queda con error y no hay alerta', async () => {
    const r = await registrarFalloJob(await jobEnProceso('EXTRACCION', 3), errorApi(400, 'invalid_request_error', 'invalid PDF'));
    expect(r.final).toBe(true);
    expect(r.mensaje).toMatch(/^\[DOCUMENTO_RECHAZADO\]/);
    expect(await alertasIaActivas()).toHaveLength(0);
  });

  it('un job que no es de IA no se clasifica', async () => {
    const r = await registrarFalloJob(await jobEnProceso('SYNC_MIS_COMPROBANTES', 1), errorApi(401, 'authentication_error', 'x'));
    expect(r.mensaje).not.toMatch(/^\[/);
    expect(await alertasIaActivas()).toHaveLength(0);
  });
});

describe('resolución', () => {
  it('una extracción exitosa cierra las alertas de la API', async () => {
    await registrarFalloJob(await jobEnProceso(), sinCredito());
    expect(await resolverAlertasIa()).toBe(1);
    expect(await alertasIaActivas()).toHaveLength(0);
    expect(await resolverAlertasIa()).toBe(0);
  });

  it('SIN_CLAVE se abre al arrancar en modo real sin clave, y sólo la cierra la configuración', async () => {
    const modo = process.env.EXTRACTOR_MODE;
    const clave = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.EXTRACTOR_MODE = 'real';
      delete process.env.ANTHROPIC_API_KEY;
      await verificarConfiguracionIa();
      expect((await alertasIaActivas()).map((a) => a.codigo)).toEqual(['SIN_CLAVE']);
      await resolverAlertasIa();
      expect(await alertasIaActivas()).toHaveLength(1);

      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      await verificarConfiguracionIa();
      expect(await alertasIaActivas()).toHaveLength(0);
    } finally {
      if (modo === undefined) delete process.env.EXTRACTOR_MODE; else process.env.EXTRACTOR_MODE = modo;
      if (clave === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = clave;
    }
  });
});
