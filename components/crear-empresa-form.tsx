'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { crearEmpresaAction, type CrearEmpresaState } from '@/app/empresas/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? 'Creando…' : 'Crear empresa'}
    </button>
  );
}

export function CrearEmpresaForm() {
  const [state, formAction] = useFormState(crearEmpresaAction, {} as CrearEmpresaState);
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="label" htmlFor="razonSocial">Razón social</label>
        <input id="razonSocial" name="razonSocial" required className="input" placeholder="Mi Empresa S.A." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="cuit">CUIT</label>
          <input id="cuit" name="cuit" required className="input" placeholder="30-12345678-9" />
        </div>
        <div>
          <label className="label" htmlFor="inicioEjercicioFiscal">Mes de inicio del ejercicio</label>
          <select id="inicioEjercicioFiscal" name="inicioEjercicioFiscal" defaultValue="7" className="input">
            {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Submit />
    </form>
  );
}
