import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { ROL_LABEL } from '@/lib/roles';
import { MES_LABEL } from '@/lib/periodos';
import { telegramHabilitado } from '@/lib/canales/telegram';
import { ErrorBanner, OkBanner } from '@/components/error-banner';
import { editarEmpresaAction, invitarUsuarioAction, cambiarRolAction, generarCodigoTelegramAction } from './actions';

export default async function ConfigPage({
  params,
  searchParams,
}: {
  params: { empresaSlug: string };
  searchParams: { error?: string; ok?: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug, 'ADMINISTRADOR');
  const [miembros, invitaciones, vinculos] = await Promise.all([
    prisma.usuarioEmpresa.findMany({
      where: { empresaId: ctx.empresa.id },
      include: { usuario: true },
      orderBy: { usuario: { nombre: 'asc' } },
    }),
    ctx.db.invitacion.findMany({ where: { aceptada: false }, orderBy: { createdAt: 'desc' } }),
    ctx.db.telegramVinculo.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);

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
