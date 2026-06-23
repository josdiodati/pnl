import { prisma } from '@/lib/db';
import { requireEmpresaPage } from '@/lib/empresa/require-empresa';
import { rolAlcanza, ROL_LABEL } from '@/lib/roles';
import { signOut } from '@/lib/auth';
import { AppShell, type NavSeccion } from '@/components/app-shell';

// Every page under /[empresaSlug] re-validates membership via requireEmpresa
// in its own loader/actions; this layout builds the chrome (sidebar + topbar).
export default async function EmpresaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { empresaSlug: string };
}) {
  const ctx = await requireEmpresaPage(params.empresaSlug);
  const [membresias, pendientes] = await Promise.all([
    prisma.usuarioEmpresa.findMany({
      where: { usuarioId: ctx.usuario.id },
      include: { empresa: true },
      orderBy: { empresa: { razonSocial: 'asc' } },
    }),
    ctx.db.movimiento.count({ where: { estado: 'PENDIENTE_VALIDACION' } }),
  ]);

  const esValidador = rolAlcanza(ctx.rol, 'VALIDADOR');
  const esAdmin = rolAlcanza(ctx.rol, 'ADMINISTRADOR');
  const base = `/${ctx.empresa.slug}`;

  const secciones: NavSeccion[] = [
    {
      titulo: 'Operación',
      items: [
        { href: `${base}/carga`, label: 'Carga', icono: 'carga' },
        ...(esValidador
          ? [
              { href: `${base}/validacion`, label: 'Validación', icono: 'validacion', badge: pendientes },
              { href: `${base}/asignacion`, label: 'Asignación', icono: 'validacion' },
            ]
          : []),
        { href: `${base}/movimientos`, label: 'Movimientos', icono: 'movimientos' },
      ],
    },
    {
      titulo: 'Registros',
      items: [
        { href: `${base}/comprobantes`, label: 'Comprobantes', icono: 'comprobante' },
        { href: `${base}/ventas`, label: 'Ventas', icono: 'venta' },
        { href: `${base}/asientos`, label: 'Asientos manuales', icono: 'asiento' },
      ],
    },
    ...(esValidador
      ? [
          {
            titulo: 'Maestros',
            items: [
              { href: `${base}/maestros/categorias`, label: 'Categorías', icono: 'categoria' },
              { href: `${base}/maestros/centros-costo`, label: 'Centros de costo', icono: 'centro' },
              { href: `${base}/maestros/clientes`, label: 'Clientes', icono: 'cliente' },
              { href: `${base}/maestros/proyectos`, label: 'Proyectos', icono: 'cliente' },
              { href: `${base}/maestros/contrapartes`, label: 'Contrapartes', icono: 'contraparte' },
              { href: `${base}/maestros/distribuciones`, label: 'Distribuciones', icono: 'distribucion' },
            ],
          },
          {
            titulo: 'Control',
            items: [
              { href: `${base}/periodos`, label: 'Períodos y cierres', icono: 'periodo' },
              ...(esAdmin ? [{ href: `${base}/auditoria`, label: 'Auditoría', icono: 'auditoria' }] : []),
              ...(esAdmin ? [{ href: `${base}/config`, label: 'Configuración', icono: 'config' }] : []),
            ],
          },
        ]
      : []),
    {
      titulo: 'Próxima etapa',
      items: [
        { href: `${base}/reportes`, label: 'Reportes P&L', icono: 'reporte', futuro: true },
        { href: `${base}/prorrateos`, label: 'Prorrateos', icono: 'prorrateo', futuro: true },
        { href: `${base}/headcount`, label: 'Headcount', icono: 'headcount', futuro: true },
      ],
    },
  ];

  return (
    <AppShell
      secciones={secciones}
      empresaNombre={ctx.empresa.razonSocial}
      rolLabel={ROL_LABEL[ctx.rol]}
      usuarioNombre={ctx.usuario.nombre}
      switcherActual={ctx.empresa.slug}
      switcherEmpresas={membresias.map((m) => ({
        slug: m.empresa.slug,
        nombre: m.empresa.razonSocial,
        rol: ROL_LABEL[m.rol],
      }))}
      salirForm={
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button className="text-xs text-ink-mute hover:text-ink underline underline-offset-2">Salir</button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
