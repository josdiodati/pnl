import Link from 'next/link';
import { AuthForm } from '@/components/auth-forms';
import { registroAction } from '../actions';

export default function RegistroPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-1">Crear cuenta</h1>
        <p className="text-sm text-slate-500 mb-6">Después vas a poder crear tu empresa o aceptar una invitación.</p>
        <AuthForm
          action={registroAction}
          fields={[
            { name: 'nombre', label: 'Nombre y apellido' },
            { name: 'email', label: 'Email', type: 'email' },
            { name: 'password', label: 'Contraseña (mínimo 8 caracteres)', type: 'password' },
          ]}
          submitLabel="Crear cuenta"
        />
        <p className="mt-4 text-sm text-slate-500">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-slate-800 underline">Ingresá</Link>
        </p>
      </div>
    </main>
  );
}
