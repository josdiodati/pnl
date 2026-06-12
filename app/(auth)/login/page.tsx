import Link from 'next/link';
import { AuthForm } from '@/components/auth-forms';
import { loginAction } from '../actions';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="reveal reveal-1 mb-6 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">P&amp;L Manager</h1>
          <span className="rule-doble !mx-auto" />
          <p className="mt-3 text-sm text-ink-mute">El libro mayor de gestión de tu grupo de empresas</p>
        </div>
        <div className="reveal reveal-2 card p-6">
          <AuthForm
            action={loginAction}
            fields={[
              { name: 'email', label: 'Email', type: 'email', placeholder: 'tu@email.com' },
              { name: 'password', label: 'Contraseña', type: 'password' },
            ]}
            submitLabel="Ingresar"
          />
        </div>
        <p className="reveal reveal-3 mt-4 text-center text-sm text-ink-mute">
          ¿No tenés cuenta?{' '}
          <Link href="/registro" className="text-accent-strong underline underline-offset-2">Registrate</Link>
        </p>
      </div>
    </main>
  );
}
