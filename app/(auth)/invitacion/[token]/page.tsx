import { prisma } from '@/lib/db';
import { AuthForm } from '@/components/auth-forms';
import { ROL_LABEL } from '@/lib/roles';
import { aceptarInvitacionAction } from '../../actions';

export default async function InvitacionPage({ params }: { params: { token: string } }) {
  const invitacion = await prisma.invitacion.findUnique({
    where: { token: params.token },
    include: { empresa: true },
  });

  if (!invitacion || invitacion.aceptada) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="card w-full max-w-sm p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">Invitación inválida</h1>
          <p className="text-sm text-slate-500">El enlace no existe o ya fue utilizado.</p>
        </div>
      </main>
    );
  }

  const usuarioExistente = await prisma.usuario.findUnique({ where: { email: invitacion.email } });

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-1">Invitación a {invitacion.empresa.razonSocial}</h1>
        <p className="text-sm text-slate-500 mb-6">
          {invitacion.email} · rol {ROL_LABEL[invitacion.rol]}
        </p>
        <AuthForm
          action={aceptarInvitacionAction}
          hidden={{ token: params.token }}
          fields={
            usuarioExistente
              ? [{ name: 'password', label: 'Tu contraseña actual', type: 'password' }]
              : [
                  { name: 'nombre', label: 'Nombre y apellido' },
                  { name: 'password', label: 'Elegí una contraseña (mínimo 8)', type: 'password' },
                ]
          }
          submitLabel="Aceptar invitación"
        />
      </div>
    </main>
  );
}
