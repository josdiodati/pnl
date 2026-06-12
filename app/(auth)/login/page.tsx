import Link from 'next/link';
import { AuthForm } from '@/components/auth-forms';
import { loginAction } from '../actions';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-1">P&amp;L Manager</h1>
        <p className="text-sm text-slate-500 mb-6">Ingresá con tu cuenta</p>
        <AuthForm
          action={loginAction}
          fields={[
            { name: 'email', label: 'Email', type: 'email', placeholder: 'tu@email.com' },
            { name: 'password', label: 'Contraseña', type: 'password' },
          ]}
          submitLabel="Ingresar"
        />
        <p className="mt-4 text-sm text-slate-500">
          ¿No tenés cuenta?{' '}
          <Link href="/registro" className="text-slate-800 underline">Registrate</Link>
        </p>
      </div>
    </main>
  );
}
