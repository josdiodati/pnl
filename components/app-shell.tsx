'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icono } from './iconos';
import { EmpresaSwitcher } from './empresa-switcher';

export type NavItem = {
  href: string;
  label: string;
  icono: string;
  badge?: number;
  futuro?: boolean;
  exacto?: boolean;
};
export type NavSeccion = { titulo: string; items: NavItem[] };

// Ledger-style application shell: ink sidebar with grouped sections + paper
// topbar. Collapses to an off-canvas drawer below lg.
export function AppShell({
  secciones,
  empresaNombre,
  rolLabel,
  usuarioNombre,
  switcherEmpresas,
  switcherActual,
  salirForm,
  children,
}: {
  secciones: NavSeccion[];
  empresaNombre: string;
  rolLabel: string;
  usuarioNombre: string;
  switcherEmpresas: { slug: string; nombre: string; rol: string }[];
  switcherActual: string;
  salirForm: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  const activo = (item: NavItem) =>
    item.exacto ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-paper">
      <Link href={`/${switcherActual}/carga`} className="px-5 pt-5 pb-4 block group">
        <span className="font-display text-[19px] font-semibold tracking-tight leading-none">
          P&amp;L Manager
        </span>
        <span className="block h-[3px] w-9 mt-2 border-t border-b border-paper/40 group-hover:border-accent transition-colors" />
        <span className="block mt-2 text-[11px] text-paper/45 truncate">{empresaNombre}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto pb-4">
        {secciones.map((s) => (
          <div key={s.titulo}>
            <p className="nav-seccion">{s.titulo}</p>
            <ul className="space-y-px pl-2">
              {s.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setAbierto(false)}
                    className={`nav-item ${activo(item) ? 'nav-item-activo' : ''} ${item.futuro ? 'nav-futuro' : ''}`}
                  >
                    <Icono nombre={item.icono} className="w-4 h-4 shrink-0 opacity-80" />
                    <span className="truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="ml-auto rounded-full bg-accent px-1.5 py-px text-[10px] font-mono font-semibold text-white">
                        {item.badge}
                      </span>
                    )}
                    {item.futuro && (
                      <span className="ml-auto rounded border border-paper/20 px-1 py-px text-[9px] uppercase tracking-wider text-paper/40">
                        próx.
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-5 py-3">
        <p className="text-[12px] text-paper/80 truncate">{usuarioNombre}</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-accent mt-0.5">{rolLabel}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      {/* Sidebar: fixed on desktop, drawer on mobile */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-40">{sidebar}</aside>
      {abierto && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 shadow-lift">{sidebar}</div>
          <button
            aria-label="Cerrar menú"
            className="flex-1 bg-ink/50 backdrop-blur-[2px]"
            onClick={() => setAbierto(false)}
          />
        </div>
      )}

      {/* Topbar */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            className="lg:hidden btn-secondary !px-2"
            aria-label="Abrir menú"
            onClick={() => setAbierto(true)}
          >
            <Icono nombre="menu" />
          </button>
          <EmpresaSwitcher actual={switcherActual} empresas={switcherEmpresas} />
          <span className="hidden sm:inline-block rounded border border-line bg-surface px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] text-ink-mute">
            {rolLabel}
          </span>
          <div className="flex-1" />
          {salirForm}
        </div>
      </header>

      <main className="p-4 lg:p-6 max-w-screen-2xl mx-auto">{children}</main>
    </div>
  );
}
