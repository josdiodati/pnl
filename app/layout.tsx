import type { Metadata } from 'next';
import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// "Libro mayor" type system: characterful serif for display, clean sans for
// UI, mono for every figure (amounts read like a well-ruled ledger).
const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['opsz', 'SOFT', 'WONK'],
});
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body' });
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'P&L Manager',
  description: 'Gestión de P&L multi-empresa: captura de comprobantes, validación y asignación a centros de costo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
