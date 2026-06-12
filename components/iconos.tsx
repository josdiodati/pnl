// Minimal stroke icon set (16px grid) — one path language for the whole app.
const PATHS: Record<string, React.ReactNode> = {
  carga: <path d="M8 10V2m0 0L5 5m3-3 3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />,
  validacion: <path d="M2.5 8.5 6 12l7.5-8" />,
  movimientos: <path d="M2 4h12M2 8h12M2 12h7" />,
  comprobante: <path d="M4 1.5h6L13 4.5v10h-9v-13zM9.5 1.5v3h3M6 8h4M6 10.5h4" />,
  venta: <path d="M8 1.5v13M11.5 4.5h-5a1.75 1.75 0 0 0 0 3.5h3a1.75 1.75 0 0 1 0 3.5h-5" />,
  asiento: <path d="M11 2.5 13.5 5 6 12.5l-3.5 1 1-3.5L11 2.5z" />,
  recurrente: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 1.5v3h-3" />,
  categoria: <path d="M2 3.5h5l1.5 2H14v7H2v-9zM2 6.5h12" />,
  centro: <path d="M2.5 13.5v-11h4v11M9.5 13.5v-7h4v7M1 13.5h14" />,
  cliente: <path d="M5.5 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 5.5 7zM1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4M10.5 7a2 2 0 1 0-.001-4.001M11 9.6c1.9.3 3.5 1.9 3.5 3.9" />,
  contraparte: <path d="M2.5 13.5v-10a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v10M5 5h2M5 7.5h2M5 10h2M10.5 6.5h3v7h-3M1 13.5h14" />,
  distribucion: <path d="M8 2v5M8 7 3 12M8 7l5 5M3 12.5a1 1 0 1 0 0 .01M13 12.5a1 1 0 1 0 0 .01M8 2.5a1 1 0 1 0 0-.01" />,
  periodo: <path d="M2.5 3.5h11v10h-11v-10zM2.5 6.5h11M5.5 2v3M10.5 2v3" />,
  config: <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13 8a5 5 0 0 0-.1-1l1.6-1.2-1.5-2.6-1.9.7a5 5 0 0 0-1.7-1L9 1H7l-.4 1.9a5 5 0 0 0-1.7 1L3 3.2 1.5 5.8 3.1 7a5 5 0 0 0 0 2l-1.6 1.2 1.5 2.6 1.9-.7a5 5 0 0 0 1.7 1L7 15h2l.4-1.9a5 5 0 0 0 1.7-1l1.9.7 1.5-2.6L12.9 9c.07-.33.1-.66.1-1z" />,
  auditoria: <path d="M8 1.5 13.5 4v4c0 3.5-2.3 5.9-5.5 6.5C4.8 13.9 2.5 11.5 2.5 8V4L8 1.5zM5.5 8 7 9.5 10.5 6" />,
  reporte: <path d="M2 13.5h12M4 13.5V9M7.33 13.5V5.5M10.66 13.5V7.5M14 13.5V3.5" />,
  prorrateo: <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5M13.5 8H8V2.5M13.5 8A5.5 5.5 0 0 0 8 2.5" />,
  headcount: <path d="M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />,
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  cerrar: <path d="M3 3l10 10M13 3 3 13" />,
};

export function Icono({ nombre, className = 'w-4 h-4' }: { nombre: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[nombre] ?? <circle cx="8" cy="8" r="6" />}
    </svg>
  );
}
