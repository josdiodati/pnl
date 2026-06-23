'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireEmpresa } from '@/lib/empresa/require-empresa';
import { isDomainError, isForbidden, DomainError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { cuitEsValido, normalizarCuit } from '@/lib/checks';
import { validarDistribucion } from '@/lib/movimientos/distribucion';
import { prisma } from '@/lib/db';

// Masters CRUD. All actions: VALIDADOR+ (enforced server-side via
// requireEmpresa, not just hidden buttons). Nothing is physically deleted —
// records are deactivated. Errors surface back via ?error= on the same tab.

function volver(slug: string, tab: string, error?: string): never {
  revalidatePath(`/${slug}/maestros/${tab}`);
  redirect(`/${slug}/maestros/${tab}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

function mensaje(err: unknown): string {
  if (isDomainError(err) || isForbidden(err)) return err.message;
  throw err;
}

// ---------- Categorías ----------

export async function guardarCategoria(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const tipo = String(formData.get('tipo')) as 'INGRESO' | 'EGRESO';
    const padreId = String(formData.get('padreId') ?? '') || null;
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    if (padreId) {
      const padre = await ctx.db.categoria.findFirst({ where: { id: padreId } });
      if (!padre) throw new DomainError('Categoría padre inexistente.');
      if (padre.padreId) throw new DomainError('La jerarquía admite como máximo 2 niveles.');
      if (padre.tipo !== tipo) throw new DomainError('La subcategoría debe ser del mismo tipo que su padre.');
    }
    if (id) {
      const antes = await ctx.db.categoria.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Categoría inexistente.');
      const hijas = await ctx.db.categoria.count({ where: { padreId: id } });
      if (padreId && hijas > 0) throw new DomainError('Una categoría con subcategorías no puede pasar a ser hija.');
      await ctx.db.categoria.update({ where: { id }, data: { nombre, tipo, padreId } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Categoria', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, tipo, padreId } });
    } else {
      const nueva = await ctx.db.categoria.create({ data: { nombre, tipo, padreId } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Categoria', entidadId: nueva.id, accion: 'CREAR', despues: { nombre, tipo, padreId } });
    }
  } catch (err) {
    volver(slug, 'categorias', mensaje(err));
  }
  volver(slug, 'categorias');
}

export async function toggleCategoria(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const cat = await ctx.db.categoria.findFirst({ where: { id } });
    if (!cat) throw new DomainError('Categoría inexistente.');
    await ctx.db.categoria.update({ where: { id }, data: { activa: !cat.activa } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Categoria', entidadId: id, accion: cat.activa ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'categorias', mensaje(err));
  }
  volver(slug, 'categorias');
}

// ---------- Centros de costo ----------

export async function guardarCentroCosto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const tipo = String(formData.get('tipo')) as 'NEGOCIO' | 'SOPORTE';
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    if (id) {
      const antes = await ctx.db.centroCosto.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Centro de costo inexistente.');
      await ctx.db.centroCosto.update({ where: { id }, data: { nombre, tipo } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'CentroCosto', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, tipo } });
    } else {
      const nuevo = await ctx.db.centroCosto.create({ data: { nombre, tipo } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'CentroCosto', entidadId: nuevo.id, accion: 'CREAR', despues: { nombre, tipo } });
    }
  } catch (err) {
    volver(slug, 'centros-costo', mensaje(err));
  }
  volver(slug, 'centros-costo');
}

export async function toggleCentroCosto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const cc = await ctx.db.centroCosto.findFirst({ where: { id } });
    if (!cc) throw new DomainError('Centro de costo inexistente.');
    await ctx.db.centroCosto.update({ where: { id }, data: { activo: !cc.activo } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'CentroCosto', entidadId: id, accion: cc.activo ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'centros-costo', mensaje(err));
  }
  volver(slug, 'centros-costo');
}

// ---------- Clientes / Proyectos ----------

export async function guardarClienteProyecto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const codigo = String(formData.get('codigo') ?? '').trim() || null;
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    if (id) {
      const antes = await ctx.db.cliente.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Cliente/proyecto inexistente.');
      await ctx.db.cliente.update({ where: { id }, data: { nombre, codigo } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, codigo } });
    } else {
      const nuevo = await ctx.db.cliente.create({ data: { nombre, codigo } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: nuevo.id, accion: 'CREAR', despues: { nombre, codigo } });
    }
  } catch (err) {
    volver(slug, 'clientes-proyectos', mensaje(err));
  }
  volver(slug, 'clientes-proyectos');
}

export async function toggleClienteProyecto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const cp = await ctx.db.cliente.findFirst({ where: { id } });
    if (!cp) throw new DomainError('Cliente/proyecto inexistente.');
    await ctx.db.cliente.update({ where: { id }, data: { activo: !cp.activo } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: id, accion: cp.activo ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'clientes-proyectos', mensaje(err));
  }
  volver(slug, 'clientes-proyectos');
}

// ---------- Contrapartes ----------

export async function guardarContraparte(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const cuit = normalizarCuit(String(formData.get('cuit') ?? ''));
    const razonSocial = String(formData.get('razonSocial') ?? '').trim();
    const tipo = String(formData.get('tipo')) as 'PROVEEDOR' | 'CLIENTE' | 'AMBOS';
    const condicionIva = String(formData.get('condicionIva') ?? '').trim() || null;
    const categoriaDefaultId = String(formData.get('categoriaDefaultId') ?? '') || null;
    const distribucionDefaultId = String(formData.get('distribucionDefaultId') ?? '') || null;
    const instruccionesExtraccion = String(formData.get('instruccionesExtraccion') ?? '').trim() || null;

    if (!razonSocial) throw new DomainError('La razón social es obligatoria.');
    if (!cuitEsValido(cuit)) throw new DomainError('CUIT inválido (dígito verificador).');
    if (categoriaDefaultId && !(await ctx.db.categoria.findFirst({ where: { id: categoriaDefaultId } }))) {
      throw new DomainError('Categoría default inexistente.');
    }
    if (distribucionDefaultId && !(await ctx.db.plantillaDistribucion.findFirst({ where: { id: distribucionDefaultId } }))) {
      throw new DomainError('Plantilla de distribución inexistente.');
    }

    const data = { cuit, razonSocial, tipo, condicionIva, categoriaDefaultId, distribucionDefaultId, instruccionesExtraccion };
    if (id) {
      const antes = await ctx.db.contraparte.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Contraparte inexistente.');
      await ctx.db.contraparte.update({ where: { id }, data });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Contraparte', entidadId: id, accion: 'EDITAR', antes, despues: data });
    } else {
      const dup = await ctx.db.contraparte.findFirst({ where: { cuit } });
      if (dup) throw new DomainError(`Ya existe una contraparte con ese CUIT (${dup.razonSocial}).`);
      const nueva = await ctx.db.contraparte.create({ data: data as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Contraparte', entidadId: nueva.id, accion: 'CREAR', despues: data });
    }
  } catch (err) {
    volver(slug, 'contrapartes', mensaje(err));
  }
  volver(slug, 'contrapartes');
}

export async function toggleContraparte(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const c = await ctx.db.contraparte.findFirst({ where: { id } });
    if (!c) throw new DomainError('Contraparte inexistente.');
    await ctx.db.contraparte.update({ where: { id }, data: { activa: !c.activa } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Contraparte', entidadId: id, accion: c.activa ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'contrapartes', mensaje(err));
  }
  volver(slug, 'contrapartes');
}

// ---------- Plantillas de distribución ----------

export async function guardarPlantillaDistribucion(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) throw new DomainError('El nombre es obligatorio.');

    // Parallel arrays from the dynamic rows
    const ccIds = formData.getAll('linea_centroCostoId').map(String);
    const cpIds = formData.getAll('linea_clienteId').map(String);
    const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
    const lineas = ccIds
      .map((cc, i) => ({ centroCostoId: cc, clienteId: cpIds[i] || null, porcentaje: pcts[i] }))
      .filter((l) => l.centroCostoId && l.porcentaje > 0);
    validarDistribucion(lineas);
    for (const l of lineas) {
      if (!(await ctx.db.centroCosto.findFirst({ where: { id: l.centroCostoId } }))) {
        throw new DomainError('Centro de costo inexistente en una línea.');
      }
      if (l.clienteId && !(await ctx.db.cliente.findFirst({ where: { id: l.clienteId } }))) {
        throw new DomainError('Cliente/proyecto inexistente en una línea.');
      }
    }

    if (id) {
      const antes = await ctx.db.plantillaDistribucion.findFirst({ where: { id }, include: { lineas: true } });
      if (!antes) throw new DomainError('Plantilla inexistente.');
      await ctx.db.plantillaDistribucion.update({ where: { id }, data: { nombre } });
      await prisma.plantillaDistribucionLinea.deleteMany({ where: { plantillaId: id } });
      await prisma.plantillaDistribucionLinea.createMany({
        data: lineas.map((l) => ({ plantillaId: id, ...l })),
      });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'PlantillaDistribucion', entidadId: id, accion: 'EDITAR', antes: { nombre: antes.nombre, lineas: antes.lineas }, despues: { nombre, lineas } });
    } else {
      const nueva = await ctx.db.plantillaDistribucion.create({ data: { nombre } as never });
      await prisma.plantillaDistribucionLinea.createMany({
        data: lineas.map((l) => ({ plantillaId: nueva.id, ...l })),
      });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'PlantillaDistribucion', entidadId: nueva.id, accion: 'CREAR', despues: { nombre, lineas } });
    }
  } catch (err) {
    volver(slug, 'distribuciones', mensaje(err));
  }
  volver(slug, 'distribuciones');
}
