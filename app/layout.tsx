import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'P&L Manager',
  description: 'Gestión de P&L multi-empresa: captura de comprobantes, validación y asignación a centros de costo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
