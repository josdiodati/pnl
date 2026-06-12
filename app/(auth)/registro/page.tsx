import Link from 'next/link';
import { AuthForm } from '@/components/auth-forms';
import { registroAction } from '../actions';

export default function RegistroPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="reveal reveal-1 mb-6 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Crear cuenta</h1>
          <span className="rule-doble !mx-auto" />
          <p className="mt-3 text-sm text-ink-mute">Después vas a poder crear tu empresa o aceptar una invitación.</p>
        </div>
        <div className="reveal reveal-2 card p-6">
          <AuthForm
            action={registroAction}
            fields={[
              { name: 'nombre', label: 'Nombre y apellido' },
              { name: 'email', label: 'Email', type: 'email' },
              { name: 'password', label: 'Contraseña (mínimo 8 caracteres)', type: 'password' },
            ]}
            submitLabel="Crear cuenta"
          />
        </div>
        <p className="reveal reveal-3 mt-4 text-center text-sm text-ink-mute">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-accent-strong underline underline-offset-2">Ingresá</Link>
        </p>
      </div>
    </main>
  );
}
