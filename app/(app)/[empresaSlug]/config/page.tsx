import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ROL_LABEL } from '@/lib/roles';
import { MES_LABEL } from '@/lib/periodos';
import { telegramHabilitado } from '@/lib/canales/telegram';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { formatFechaHora } from '@/lib/format';
import { cifradoConfigurado } from '@/lib/arca/mis-comprobantes/cifrado';
import {
  editarEmpresaAction,
  invitarUsuarioAction,
  cambiarRolAction,
  generarCodigoTelegramAction,
  guardarCredencialArcaAction,
  probarCredencialArcaAction,
  borrarCredencialArcaAction,
  syncAutomaticoArcaAction,
} from './actions';

export default async function ConfigPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const [miembros, invitaciones, vinculos, credencialArca] = await Promise.all([
    prisma.usuarioEmpresa.findMany({
      where: { empresaId: ctx.empresa.id },
      include: { usuario: true },
      orderBy: { usuario: { nombre: 'asc' } },
    }),
    ctx.db.invitacion.findMany({ where: { aceptada: false }, orderBy: { createdAt: 'desc' } }),
    ctx.db.telegramVinculo.findMany({ orderBy: { createdAt: 'desc' } }),
    ctx.db.credencialArca.findFirst({ where: {} }),
  ]);
  const cifradoOk = cifradoConfigurado();

  const dominio = process.env.INBOUND_EMAIL_DOMAIN ?? 'tu-dominio.com';
  const emailEntrante = `comprobantes+${ctx.empresa.slug}@${dominio}`;
  const emailHabilitado = Boolean(process.env.INBOUND_EMAIL_SECRET);

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-lg font-semibold">Configuración de {ctx.empresa.razonSocial}</h1>
      <ErrorBanner mensaje={searchParams.error} />
      <OkBanner mensaje={searchParams.ok} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">Datos de la empresa</h2>
        <form action={editarEmpresaAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <div className="w-64">
            <label className="label">Razón social</label>
            <input name="razonSocial" required defaultValue={ctx.empresa.razonSocial} className="input" />
          </div>
          <div className="w-44">
            <label className="label">CUIT</label>
            <input name="cuit" required defaultValue={ctx.empresa.cuit} className="input" />
          </div>
          <div>
            <label className="label">Inicio del ejercicio</label>
            <select name="inicioEjercicioFiscal" defaultValue={String(ctx.empresa.inicioEjercicioFiscal)} className="input">
              {MES_LABEL.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary">Guardar</button>
        </form>
        <p className="text-xs text-slate-400 mt-2">URL de la empresa: /{ctx.empresa.slug}</p>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Usuarios y roles</h2>
        <table className="table-base mb-4">
          <thead>
            <tr><th>Nombre</th><th>Email</th><th>Rol</th><th></th></tr>
          </thead>
          <tbody>
            {miembros.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.usuario.nombre}{m.usuarioId === ctx.usuario.id && ' (vos)'}</td>
                <td>{m.usuario.email}</td>
                <td>{ROL_LABEL[m.rol]}</td>
                <td className="text-right">
                  <form action={cambiarRolAction} className="inline-flex items-center gap-1">
                    <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
                    <input type="hidden" name="usuarioId" value={m.usuarioId} />
                    <select name="rol" defaultValue={m.rol} className="input !w-auto text-xs">
                      <option value="CARGADOR">Cargador</option>
                      <option value="VALIDADOR">Validador</option>
                      <option value="ADMINISTRADOR">Administrador</option>
                    </select>
                    <button className="btn-secondary text-xs">Cambiar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="text-sm font-medium mb-2">Invitar usuario</h3>
        <form action={invitarUsuarioAction} className="flex flex-wrap items-end gap-3 mb-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <div className="w-64">
            <label className="label">Email</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label">Rol</label>
            <select name="rol" className="input" defaultValue="CARGADOR">
              <option value="CARGADOR">Cargador</option>
              <option value="VALIDADOR">Validador</option>
              <option value="ADMINISTRADOR">Administrador</option>
            </select>
          </div>
          <button className="btn-primary">Crear invitación</button>
        </form>
        {invitaciones.length > 0 && (
          <ul className="space-y-1 text-sm">
            {invitaciones.map((i) => (
              <li key={i.id} className="text-slate-600">
                {i.email} ({ROL_LABEL[i.rol]}) — enlace:{' '}
                <code className="bg-slate-100 px-1 rounded text-xs break-all">/invitacion/{i.token}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <h2 className="font-medium">ARCA · Mis Comprobantes</h2>
          <p className="text-xs text-slate-500">
            Con esta Clave Fiscal PNL entra al portal de ARCA todos los días a las 06:30 y baja los comprobantes emitidos y
            recibidos de {ctx.empresa.razonSocial}. La clave se guarda cifrada y nunca se muestra ni se registra.
          </p>
        </div>
        {!cifradoOk && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Falta configurar <code>ARCA_PORTAL_SECRET</code> en el servidor: hasta entonces no se puede guardar la clave.
          </p>
        )}
        {credencialArca?.estado === 'BLOQUEADA' && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">
              Falló el ingreso a ARCA{credencialArca.ultimoIntentoAt ? ` el ${formatFechaHora(credencialArca.ultimoIntentoAt)}` : ''}: {credencialArca.motivoBloqueo}
            </p>
            <p className="text-xs mt-1">
              Para no bloquear la Clave Fiscal, PNL no volvió a intentar. Verificá si cambió la clave: guardala de nuevo y tocá «Probar
              ingreso» (un único intento). Si la clave sigue siendo la misma, probá directamente.
            </p>
          </div>
        )}
        <form action={guardarCredencialArcaAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
          <div className="w-48">
            <label className="label">CUIT que ingresa</label>
            <input name="cuitUsuario" required defaultValue={credencialArca?.cuitUsuario ?? ''} className="input" placeholder="20-12345678-9" title="El CUIT de la persona (administrador de relaciones) que tiene delegado Mis Comprobantes de esta empresa" />
          </div>
          <div className="w-56">
            <label className="label">Clave Fiscal</label>
            <input name="clave" type="password" required className="input" autoComplete="new-password" placeholder={credencialArca ? '•••••••• (guardada)' : ''} />
          </div>
          <button className="btn-primary" disabled={!cifradoOk}>{credencialArca ? 'Reemplazar clave' : 'Guardar clave'}</button>
        </form>
        {credencialArca && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                credencialArca.estado === 'OK' ? 'bg-emerald-100 text-emerald-800' : credencialArca.estado === 'BLOQUEADA' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {credencialArca.estado === 'OK' ? 'Ingreso verificado' : credencialArca.estado === 'BLOQUEADA' ? 'Bloqueada' : 'Sin probar'}
            </span>
            <form action={probarCredencialArcaAction}>
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <button className="btn-secondary text-xs" title="Hace un único intento de login en ARCA con la clave guardada">
                Probar ingreso
              </button>
            </form>
            <form action={syncAutomaticoArcaAction}>
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <input type="hidden" name="activo" value={credencialArca.syncAutomatico ? '0' : '1'} />
              <button className="btn-secondary text-xs">{credencialArca.syncAutomatico ? 'Desactivar sync diario' : 'Activar sync diario'}</button>
            </form>
            <form action={borrarCredencialArcaAction}>
              <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
              <button className="btn-danger text-xs">Borrar credencial</button>
            </form>
            <span className="text-xs text-slate-500">
              {credencialArca.ultimoOkAt ? `Último ingreso OK: ${formatFechaHora(credencialArca.ultimoOkAt)}` : 'Nunca ingresó'}
              {credencialArca.ultimaSyncAt ? ` · última sync: ${formatFechaHora(credencialArca.ultimaSyncAt)}` : ''}
              {credencialArca.syncAutomatico ? ' · sync diario 06:30' : ' · sync diario apagado'}
            </span>
          </div>
        )}
        {credencialArca?.ultimoErrorSync && credencialArca.estado !== 'BLOQUEADA' && (
          <p className="text-xs text-amber-700">
            Último error (no es de la clave{credencialArca.erroresSeguidos > 1 ? `, ${credencialArca.erroresSeguidos} seguidos` : ''}): {credencialArca.ultimoErrorSync}
          </p>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-2">Canal email entrante</h2>
        <p className="text-sm text-slate-600">
          Dirección de esta empresa: <code className="bg-slate-100 px-1 rounded">{emailEntrante}</code>
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {emailHabilitado
            ? 'Webhook habilitado (INBOUND_EMAIL_SECRET configurado). Apuntá tu proveedor (Postmark/SES) a POST /api/inbound-email.'
            : 'Canal deshabilitado: configurá INBOUND_EMAIL_SECRET y un proveedor de email entrante (ver README). Podés probarlo igual con un payload de ejemplo.'}
        </p>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-2">Canal Telegram</h2>
        <p className="text-xs text-slate-500 mb-2">
          {telegramHabilitado()
            ? 'Bot habilitado (TELEGRAM_BOT_TOKEN configurado).'
            : 'Bot deshabilitado: falta TELEGRAM_BOT_TOKEN (ver README para crearlo con BotFather). El webhook acepta payloads de prueba igualmente.'}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {ctx.empresa.telegramCodigoVinculo ? (
            <p className="text-sm">
              Código de vínculo: <code className="bg-slate-100 px-2 py-0.5 rounded font-semibold">{ctx.empresa.telegramCodigoVinculo}</code>
              <span className="text-xs text-slate-500 ml-2">En el chat del bot: /vincular {ctx.empresa.telegramCodigoVinculo}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-500">Todavía no generaste un código de vínculo.</p>
          )}
          <form action={generarCodigoTelegramAction}>
            <input type="hidden" name="empresaSlug" value={params.empresaSlug} />
            <button className="btn-secondary text-xs">{ctx.empresa.telegramCodigoVinculo ? 'Regenerar código' : 'Generar código'}</button>
          </form>
        </div>
        {vinculos.length > 0 && (
          <p className="text-xs text-slate-500 mt-2">
            Chats vinculados: {vinculos.map((v) => v.chatId).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
