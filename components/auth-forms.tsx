'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { AuthFormState } from '@/app/(auth)/actions';

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
      {pending ? 'Procesando…' : children}
    </button>
  );
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden,
}: {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  fields: { name: string; label: string; type?: string; placeholder?: string; defaultValue?: string; readOnly?: boolean }[];
  submitLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useFormState(action, {} as AuthFormState);
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            defaultValue={f.defaultValue}
            readOnly={f.readOnly}
            required
            className={`input ${f.readOnly ? 'bg-slate-100 text-slate-500' : ''}`}
          />
        </div>
      ))}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
