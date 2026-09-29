# Emails con Resend (avisos salientes + facturas entrantes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app mande por mail las alertas de la extracción con IA (las de `a63f6b0`) y que reciba facturas por mail en `comprobantes+{empresa}@ledger.ar` usando Resend.

**Architecture:** Un cliente HTTP mínimo de Resend (`fetch`, sin SDK nuevo). Salida: las alertas de `lib/ia/alertas.ts` agregan el mail al aviso que hoy va por Telegram. Entrada: el worker **consulta** `GET /emails/receiving` cada minuto (no webhook: Cloudflare Access bloquea todo POST entrante a pnl.ledger.ar), baja los adjuntos y encola el job `EMAIL_IN` que ya existe; desde ahí el flujo es el mismo que una subida web (lote de ingesta, extracción, validación).

**Tech Stack:** Next.js 14 / TypeScript, Prisma + Postgres, worker propio (`worker.ts`), vitest. API REST de Resend (`https://api.resend.com`, `Authorization: Bearer $RESEND_API_KEY`).

**Spec:** este plan (decisiones D1–D6 abajo) + conversación del 29-sep. Estado verificado del dominio `ledger.ar` en Resend: envío VERIFICADO (DKIM + SPF), recepción PENDIENTE del registro MX.

## Decisiones (a confirmar por el usuario)

- **D1 Remitente:** `P&L Manager <avisos@ledger.ar>`. En Resend no se "crean casillas": cualquier dirección `@ledger.ar` sirve como remitente una vez verificado el dominio. Configurable con `EMAIL_REMITENTE`.
- **D2 Destinatarios (decidido por el usuario, 29-sep):** cada aviso va a la casilla relevante según su alcance:
  | Alcance | Ejemplos | Destinatario |
  |---|---|---|
  | Carga | comprobante, resumen o recibo que terminó con error de procesamiento | el usuario que lo cargó (`Movimiento.creadoPorId`; `usuarioId` del job de resumen/recibo) |
  | Empresa | clave de ARCA bloqueada en el sync automático; sync de Mis Comprobantes que falla 3 veces seguidas | todos los `ADMINISTRADOR` de esa empresa |
  | Aplicación | alertas de IA (`SIN_CREDITO`, `CLAVE_INVALIDA`, `LIMITE_GASTO`…) | el owner: `APP_OWNER_EMAIL` (= `jdiodati@kawellu.com.ar` en prod) |

  El sync de ARCA con 3 errores seguidos (timeout, WAF, cambio del portal) suele ser un problema de la app, así que va a los admins **y** al owner. Los documentos en espera por un error de Aplicación NO avisan a cada cargador (lo resuelve el owner; el banner lo muestra a todos). `ALERTAS_TELEGRAM_CHAT_ID` sigue siendo opcional y sólo para Aplicación.
- **D3 Dirección de entrada:** se mantiene el formato que ya usa la app, `comprobantes+{slug}@ledger.ar` (hoy `comprobantes+kawellu@ledger.ar` y `comprobantes+ewwo@ledger.ar`). Resend recibe cualquier dirección del dominio; las que no tienen slug válido se ignoran y quedan en el log.
- **D4 Polling, no webhook:** cada 60 s desde el programador del worker. Evita pedir un bypass de Cloudflare Access y verificar firmas svix. Latencia máxima ~1 min.
- **D5 Remitentes:** se acepta cualquiera (los proveedores mandan desde direcciones propias). Barreras: sólo PDF/JPG/PNG/WEBP (ya filtrado en `procesarEmailEntrante`), máx. 10 adjuntos y 15 MB por adjunto, y el control de archivo duplicado existente. Si aparece spam, se agrega una lista blanca por empresa.
- **D6 Idempotencia:** cada mail de Resend se registra en `EventoWebhook` con `canal = 'RESEND'` y su `id` **después** de encolarlo; un mail cuyo adjunto falla al bajar se reintenta en la próxima pasada.

## Acción del usuario (DNS, fuera del código)

En Cloudflare → DNS de `ledger.ar`: registro **MX**, nombre `@`, servidor `inbound-smtp.sa-east-1.amazonaws.com`, prioridad `10`, proxy apagado (los MX no se proxean). `ledger.ar` no tiene otro MX, así que no pisa ninguna casilla existente. Después, en Resend → Domains → ledger.ar → "Verify".

## Global Constraints

- Sin dependencias nuevas: el cliente de Resend es `fetch`.
- La salida del servidor sólo permite 443/80/53/7844: todo contra `https://api.resend.com` y `https://inbound-cdn.resend.com`.
- Nunca imprimir `RESEND_API_KEY` (ya está en `/opt/pnl-manager/app/.env` de pnlvm; no en el `.env` local).
- Sin `RESEND_API_KEY` todo esto queda apagado en silencio (dev/tests): no rompe el worker.
- Los textos visibles al usuario van en castellano rioplatense, como el resto de la app.
- Commits sin línea de atribución a Claude (CLAUDE.md del usuario).

## Review Focus

- Mail a una dirección sin slug o con slug inexistente (`hola@ledger.ar`, `comprobantes+nadie@ledger.ar`) → se ignora, se registra como visto y NO tira el programador. Test en Task 3.
- Mail sin adjuntos útiles (sólo firma PNG inline + cuerpo) → hoy la firma inline entraría como comprobante. Se descartan adjuntos `content_disposition: 'inline'`. Test en Task 3.
- Resend caído o key revocada durante el polling → se loguea, se reintenta en el próximo minuto, no se marca nada como visto. Test en Task 3.
- El mismo mail visto en dos pasadas (la lista trae los últimos 100) → se encola una sola vez. Test en Task 3.
- Falla el envío del mail de alerta → la alerta igual queda registrada (el aviso es best-effort). Test en Task 2.

---

### Task 1: Cliente de Resend

**Files:**
- Create: `lib/canales/resend.ts`
- Test: `tests/resend-cliente.test.ts`

**Interfaces:**
- Produces:
  - `resendHabilitado(): boolean`
  - `enviarEmail(m: { to: string[]; subject: string; text: string }, f?: typeof fetch): Promise<void>` (lanza si Resend responde ≠ 2xx)
  - `listarRecibidos(f?: typeof fetch): Promise<RecibidoResend[]>` — últimos 100, del más nuevo al más viejo
  - `listarAdjuntos(emailId: string, f?: typeof fetch): Promise<AdjuntoResend[]>`
  - `descargarAdjunto(url: string, f?: typeof fetch): Promise<Buffer>`
  - `type RecibidoResend = { id: string; from: string; to: string[]; subject: string; created_at: string }`
  - `type AdjuntoResend = { id: string; filename: string; content_type: string; content_disposition: string | null; size: number; download_url: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { enviarEmail, listarRecibidos, listarAdjuntos, resendHabilitado } from '@/lib/canales/resend';

const llamadas: { url: string; init?: RequestInit }[] = [];
const fakeFetch = (respuesta: unknown, status = 200) =>
  (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuesta), { status });
  }) as unknown as typeof fetch;

afterEach(() => { llamadas.length = 0; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_REMITENTE; });

describe('cliente Resend', () => {
  it('sin key está deshabilitado', () => {
    expect(resendHabilitado()).toBe(false);
  });

  it('enviarEmail usa el remitente por defecto y la key como Bearer', async () => {
    process.env.RESEND_API_KEY = 're_test';
    await enviarEmail({ to: ['a@b.com'], subject: 'Hola', text: 'cuerpo' }, fakeFetch({ id: 'x' }));
    expect(llamadas[0].url).toBe('https://api.resend.com/emails');
    expect((llamadas[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(llamadas[0].init!.body))).toEqual({
      from: 'P&L Manager <avisos@ledger.ar>', to: ['a@b.com'], subject: 'Hola', text: 'cuerpo',
    });
  });

  it('enviarEmail lanza con el mensaje de Resend si falla', async () => {
    process.env.RESEND_API_KEY = 're_test';
    await expect(enviarEmail({ to: ['a@b.com'], subject: 's', text: 't' }, fakeFetch({ name: 'validation_error', message: 'bad from' }, 422)))
      .rejects.toThrow(/422.*bad from/);
  });

  it('listarRecibidos y listarAdjuntos devuelven data', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const r = await listarRecibidos(fakeFetch({ object: 'list', data: [{ id: 'm1', from: 'p@x.com', to: ['comprobantes+kawellu@ledger.ar'], subject: 'F', created_at: '2026-09-29T12:00:00Z' }] }));
    expect(llamadas[0].url).toBe('https://api.resend.com/emails/receiving?limit=100');
    expect(r[0].id).toBe('m1');
    const a = await listarAdjuntos('m1', fakeFetch({ object: 'list', data: [{ id: 'a1', filename: 'f.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: 10, download_url: 'https://inbound-cdn.resend.com/x' }] }));
    expect(llamadas[1].url).toBe('https://api.resend.com/emails/receiving/m1/attachments');
    expect(a[0].filename).toBe('f.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resend-cliente.test.ts`
Expected: FAIL — `Cannot find module '@/lib/canales/resend'`

- [ ] **Step 3: Write minimal implementation**

```ts
// Cliente mínimo de la API de Resend (envío y recepción de mails) sobre
// fetch. Sin RESEND_API_KEY el canal queda apagado. El `f` opcional es para
// los tests. Recepción por polling: ver lib/canales/resend-entrante.ts.

const API = 'https://api.resend.com';
const REMITENTE_DEFAULT = 'P&L Manager <avisos@ledger.ar>';

export type RecibidoResend = { id: string; from: string; to: string[]; subject: string; created_at: string };
export type AdjuntoResend = {
  id: string; filename: string; content_type: string; content_disposition: string | null; size: number; download_url: string;
};

export function resendHabilitado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function llamar(path: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<any> {
  const res = await f(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${cuerpo?.message ?? res.statusText}`);
  return cuerpo;
}

export async function enviarEmail(m: { to: string[]; subject: string; text: string }, f?: typeof fetch): Promise<void> {
  const from = process.env.EMAIL_REMITENTE || REMITENTE_DEFAULT;
  await llamar('/emails', { method: 'POST', body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text }) }, f);
}

export async function listarRecibidos(f?: typeof fetch): Promise<RecibidoResend[]> {
  return (await llamar('/emails/receiving?limit=100', {}, f)).data ?? [];
}

export async function listarAdjuntos(emailId: string, f?: typeof fetch): Promise<AdjuntoResend[]> {
  return (await llamar(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {}, f)).data ?? [];
}

/** La download_url es un link firmado temporal (1 h): no lleva la key. */
export async function descargarAdjunto(url: string, f: typeof fetch = fetch): Promise<Buffer> {
  const res = await f(url);
  if (!res.ok) throw new Error(`Resend adjunto ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/resend-cliente.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/canales/resend.ts tests/resend-cliente.test.ts
git commit -m "feat(resend): cliente mínimo para enviar y listar mails recibidos"
```

---

### Task 2: Avisos por mail a la casilla relevante (HECHO, f4b4668)

Reemplaza el `ALERTAS_EMAIL` único del borrador por el ruteo de D2.

**Files:**
- Create: `lib/notificaciones.ts` — `type Destino = {tipo:'APP'} | {tipo:'EMPRESA', empresaId} | {tipo:'USUARIO', usuarioId}`; `destinatarios(d)`, `notificar(destinos, asunto, texto)` (junta casillas sin repetir, best-effort, firma con `APP_URL`), `notificarErrorCarga(tipoJob, payload, error)`.
- Modify: `lib/ia/alertas.ts` — las alertas de IA avisan con `notificar({tipo:'APP'})` (+ Telegram opcional) al abrirse y al resolverse.
- Modify: `worker.ts` — cuando un job de extracción (comprobante, resumen, recibo) termina con error final, `notificarErrorCarga` al que lo cargó.
- Modify: `lib/arca/mis-comprobantes/service.ts` — clave bloqueada en el sync automático (sin `usuarioId`) avisa a los admins; el 3.er error seguido del portal avisa a admins + owner, una sola vez.
- Tests: `tests/notificaciones.test.ts` (10), `tests/ia-alertas-mail.test.ts` (4), `tests/arca-avisos.test.ts` (3).

---

### Task 3: Recepción de facturas por polling

**Files:**
- Create: `lib/canales/resend-entrante.ts`
- Modify: `lib/canales/telegram.ts:118` — `registrarEventoUnico(canal: 'EMAIL' | 'TELEGRAM' | 'RESEND', …)` y agregar `yaRegistrado(canal, clave): Promise<boolean>`
- Test: `tests/resend-entrante.test.ts`

**Interfaces:**
- Consumes: `listarRecibidos`, `listarAdjuntos`, `descargarAdjunto`, tipos de Task 1; `slugDesdeDireccion`, `EmailInPayload` de `lib/canales/email.ts`; `enqueueJob` de `lib/jobs.ts`.
- Produces: `sincronizarRecibidos(deps?: Partial<Deps>): Promise<{ encolados: number; ignorados: number }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { sincronizarRecibidos } from '@/lib/canales/resend-entrante';
import type { RecibidoResend, AdjuntoResend } from '@/lib/canales/resend';

const mail = (id: string, to: string): RecibidoResend => ({ id, from: 'proveedor@x.com', to: [to], subject: 'Factura', created_at: '2026-09-29T12:00:00Z' });
const pdf = (id: string, extra: Partial<AdjuntoResend> = {}): AdjuntoResend =>
  ({ id, filename: `${id}.pdf`, content_type: 'application/pdf', content_disposition: 'attachment', size: 1000, download_url: `https://cdn/${id}`, ...extra });

function deps(recibidos: RecibidoResend[], adjuntos: Record<string, AdjuntoResend[]>, opts: { fallaDescarga?: boolean } = {}) {
  return {
    listarRecibidos: async () => recibidos,
    listarAdjuntos: async (id: string) => adjuntos[id] ?? [],
    descargarAdjunto: async () => { if (opts.fallaDescarga) throw new Error('Resend adjunto 500'); return Buffer.from('%PDF-1.4'); },
  };
}

const ids = ['rs-1', 'rs-2', 'rs-3', 'rs-4', 'rs-5'];
beforeEach(async () => {
  await prisma.eventoWebhook.deleteMany({ where: { canal: 'RESEND', claveExterna: { in: ids } } });
  await prisma.job.deleteMany({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], string_starts_with: 'resend:rs-' } } });
});
afterAll(async () => {
  await prisma.eventoWebhook.deleteMany({ where: { canal: 'RESEND', claveExterna: { in: ids } } });
  await prisma.job.deleteMany({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], string_starts_with: 'resend:rs-' } } });
});

describe('sincronizarRecibidos', () => {
  it('encola un EMAIL_IN con los adjuntos en base64 para la empresa del slug', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-1', 'Comprobantes+Kawellu@ledger.ar')], { 'rs-1': [pdf('a1')] }));
    expect(r).toEqual({ encolados: 1, ignorados: 0 });
    const job = await prisma.job.findFirstOrThrow({ where: { tipo: 'EMAIL_IN', payload: { path: ['messageId'], equals: 'resend:rs-1' } } });
    const p = job.payload as any;
    expect(p.adjuntos).toEqual([{ nombre: 'a1.pdf', contentType: 'application/pdf', contenidoBase64: Buffer.from('%PDF-1.4').toString('base64') }]);
  });

  it('el mismo mail en dos pasadas se encola una sola vez', async () => {
    const d = deps([mail('rs-2', 'comprobantes+kawellu@ledger.ar')], { 'rs-2': [pdf('a2')] });
    await sincronizarRecibidos(d);
    const r = await sincronizarRecibidos(d);
    expect(r).toEqual({ encolados: 0, ignorados: 0 });
  });

  it('dirección sin slug o empresa inexistente: se ignora y queda como visto', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-3', 'hola@ledger.ar'), mail('rs-4', 'comprobantes+nadie@ledger.ar')], {}));
    expect(r).toEqual({ encolados: 0, ignorados: 2 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: { in: ['rs-3', 'rs-4'] } } })).toBe(2);
  });

  it('descarta adjuntos inline, no permitidos o de más de 15 MB; sin adjuntos útiles se ignora', async () => {
    const r = await sincronizarRecibidos(deps([mail('rs-5', 'comprobantes+kawellu@ledger.ar')], {
      'rs-5': [pdf('firma', { content_type: 'image/png', content_disposition: 'inline' }), pdf('zip', { content_type: 'application/zip' }), pdf('grande', { size: 16 * 1024 * 1024 })],
    }));
    expect(r).toEqual({ encolados: 0, ignorados: 1 });
  });

  it('si falla la descarga no marca el mail como visto (se reintenta)', async () => {
    await expect(sincronizarRecibidos(deps([mail('rs-1', 'comprobantes+kawellu@ledger.ar')], { 'rs-1': [pdf('a1')] }, { fallaDescarga: true })))
      .resolves.toEqual({ encolados: 0, ignorados: 0 });
    expect(await prisma.eventoWebhook.count({ where: { canal: 'RESEND', claveExterna: 'rs-1' } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resend-entrante.test.ts`
Expected: FAIL — `Cannot find module '@/lib/canales/resend-entrante'`

- [ ] **Step 3: Implementation**

En `lib/canales/telegram.ts`:

```ts
export async function registrarEventoUnico(canal: 'EMAIL' | 'TELEGRAM' | 'RESEND', claveExterna: string): Promise<boolean> {
  // (cuerpo igual)
}

export async function yaRegistrado(canal: 'EMAIL' | 'TELEGRAM' | 'RESEND', claveExterna: string): Promise<boolean> {
  return (await prisma.eventoWebhook.count({ where: { canal, claveExterna } })) > 0;
}
```

`lib/canales/resend-entrante.ts`:

```ts
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { slugDesdeDireccion, type EmailInPayload } from '@/lib/canales/email';
import { registrarEventoUnico, yaRegistrado } from '@/lib/canales/telegram';
import * as resend from '@/lib/canales/resend';

// Facturas por mail vía Resend, por POLLING (Cloudflare Access no deja
// entrar webhooks a pnl.ledger.ar). El worker llama a sincronizarRecibidos
// una vez por minuto: por cada mail nuevo a comprobantes+{slug}@dominio baja
// los adjuntos y encola el mismo EMAIL_IN que usa el webhook de email.

const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ADJUNTOS = 10;

type Deps = Pick<typeof resend, 'listarRecibidos' | 'listarAdjuntos' | 'descargarAdjunto'>;

export async function sincronizarRecibidos(deps: Partial<Deps> = {}): Promise<{ encolados: number; ignorados: number }> {
  const d: Deps = { listarRecibidos: resend.listarRecibidos, listarAdjuntos: resend.listarAdjuntos, descargarAdjunto: resend.descargarAdjunto, ...deps };
  let encolados = 0;
  let ignorados = 0;
  // La lista viene del más nuevo al más viejo; se procesa en orden de llegada.
  for (const m of [...(await d.listarRecibidos())].reverse()) {
    if (await yaRegistrado('RESEND', m.id)) continue;
    const ignorar = async (motivo: string) => {
      console.log(`[resend] mail ${m.id} de ${m.from} a ${m.to.join(',')} ignorado: ${motivo}`);
      await registrarEventoUnico('RESEND', m.id);
      ignorados++;
    };
    const destino = m.to.find((t) => slugDesdeDireccion(t));
    const slug = destino ? slugDesdeDireccion(destino) : null;
    const empresa = slug ? await prisma.empresa.findUnique({ where: { slug } }) : null;
    if (!empresa) { await ignorar(slug ? `empresa inexistente "${slug}"` : 'dirección sin comprobantes+{empresa}'); continue; }

    const utiles = (await d.listarAdjuntos(m.id))
      .filter((a) => a.content_disposition !== 'inline' && MIMES.has(a.content_type) && a.size <= MAX_BYTES)
      .slice(0, MAX_ADJUNTOS);
    if (!utiles.length) { await ignorar('sin adjuntos PDF/imagen'); continue; }

    try {
      const adjuntos = [];
      for (const a of utiles) {
        const buf = await d.descargarAdjunto(a.download_url);
        adjuntos.push({ nombre: a.filename || 'adjunto.pdf', contentType: a.content_type, contenidoBase64: buf.toString('base64') });
      }
      const payload: EmailInPayload = { messageId: `resend:${m.id}`, from: m.from, to: destino!, adjuntos };
      await enqueueJob('EMAIL_IN', payload as never, empresa.id);
      await registrarEventoUnico('RESEND', m.id);
      encolados++;
    } catch (err) {
      // No se marca como visto: se reintenta en la próxima pasada.
      console.error(`[resend] mail ${m.id}: no se pudieron bajar los adjuntos:`, err instanceof Error ? err.message : err);
    }
  }
  return { encolados, ignorados };
}
```

Nota: `slugDesdeDireccion` ya pasa a minúsculas, así que `Comprobantes+Kawellu@…` funciona.

- [ ] **Step 4: Run tests** — `npx vitest run tests/resend-entrante.test.ts` → PASS (5 tests)
- [ ] **Step 5: Commit** — `git commit -m "feat(resend): facturas por mail a comprobantes+{empresa}@ledger.ar por polling"`

---

### Task 4: Worker, pantalla de Configuración y deploy

**Files:**
- Modify: `worker.ts` (`correrProgramador`)
- Modify: `app/(app)/[empresaSlug]/config/page.tsx:~300` (texto del canal de email)
- Modify: `.env` de pnlvm: `INBOUND_EMAIL_DOMAIN=ledger.ar`, `APP_OWNER_EMAIL=jdiodati@kawellu.com.ar`

**Interfaces:**
- Consumes: `sincronizarRecibidos` (Task 3), `resendHabilitado` (Task 1).

- [ ] **Step 1: Programador** — en `worker.ts`, dentro de `correrProgramador` (ya corre una vez por minuto), después del sync de ARCA:

```ts
  if (resendHabilitado()) {
    try {
      const r = await sincronizarRecibidos();
      if (r.encolados || r.ignorados) console.log(`[worker] mails de Resend: ${r.encolados} encolado(s), ${r.ignorados} ignorado(s)`);
    } catch (err) {
      console.error('[worker] recepción de mails (Resend) falló:', err instanceof Error ? err.message : err);
    }
  }
```

con los imports `import { sincronizarRecibidos } from '@/lib/canales/resend-entrante';` y `import { resendHabilitado } from '@/lib/canales/resend';`.

- [ ] **Step 2: Configuración** — en la tarjeta del canal de email, cuando `resendHabilitado()`: mostrar `Mandá o reenviá facturas a comprobantes+{slug}@{INBOUND_EMAIL_DOMAIN}` (con el slug de la empresa actual) en lugar del texto del webhook Postmark/SES.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit -p .`, `npx vitest run` (todo verde salvo `empleados-pdf.test.ts`, que necesita un PDF gitignoreado), `npm run build`.

- [ ] **Step 4: Commit y deploy** — commit; deploy con el runbook de pnlvm (rsync + build + restart, sin `prisma db push`: no hay cambio de schema); agregar `INBOUND_EMAIL_DOMAIN=ledger.ar` y `APP_OWNER_EMAIL` al `.env` de pnlvm; `systemctl restart pnl-worker`.

- [ ] **Step 5: Prueba punta a punta (con el usuario)**
  1. Mail de prueba de alertas: desde pnlvm, `npx tsx` con `notificar({ tipo: 'APP' }, 'Prueba P&L', 'ok')` → llega a la casilla (revisar spam la primera vez).
  2. Con el MX ya verificado: el usuario manda una factura PDF a `comprobantes+ewwo@ledger.ar` → en ≤ 1 min `journalctl -u pnl-worker` muestra `mails de Resend: 1 encolado(s)` y aparece un lote con canal EMAIL en /ewwo/carga.
