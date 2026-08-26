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
    const esCostoPersonal = formData.get('esCostoPersonal') === '1';
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
      await ctx.db.categoria.update({ where: { id }, data: { nombre, tipo, padreId, esCostoPersonal } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Categoria', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, tipo, padreId, esCostoPersonal } });
    } else {
      const nueva = await ctx.db.categoria.create({ data: { nombre, tipo, padreId, esCostoPersonal } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Categoria', entidadId: nueva.id, accion: 'CREAR', despues: { nombre, tipo, padreId, esCostoPersonal } });
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

// ---------- Clientes ----------

export async function guardarCliente(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const codigo = String(formData.get('codigo') ?? '').trim() || null;
    // Árbol de asignación: el cliente puede clasificarse bajo un centro de
    // costo (null = sin clasificar, disponible en cualquier rama).
    const centroCostoId = String(formData.get('centroCostoId') ?? '') || null;
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    if (centroCostoId) {
      const cc = await ctx.db.centroCosto.findFirst({ where: { id: centroCostoId } });
      if (!cc) throw new DomainError('Centro de costo inexistente.');
    }
    if (id) {
      const antes = await ctx.db.cliente.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Cliente inexistente.');
      await ctx.db.cliente.update({ where: { id }, data: { nombre, codigo, centroCostoId } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, codigo, centroCostoId } });
    } else {
      const nuevo = await ctx.db.cliente.create({ data: { nombre, codigo, centroCostoId } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: nuevo.id, accion: 'CREAR', despues: { nombre, codigo, centroCostoId } });
    }
  } catch (err) {
    volver(slug, 'clientes', mensaje(err));
  }
  volver(slug, 'clientes');
}

export async function toggleCliente(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const c = await ctx.db.cliente.findFirst({ where: { id } });
    if (!c) throw new DomainError('Cliente inexistente.');
    await ctx.db.cliente.update({ where: { id }, data: { activo: !c.activo } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Cliente', entidadId: id, accion: c.activo ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'clientes', mensaje(err));
  }
  volver(slug, 'clientes');
}

// ---------- Proyectos ----------

export async function guardarProyecto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    const codigo = String(formData.get('codigo') ?? '').trim() || null;
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    // Árbol: el proyecto puede clasificarse bajo un cliente (null = libre).
    const clienteId = String(formData.get('clienteId') ?? '') || null;
    if (clienteId) {
      const cli = await ctx.db.cliente.findFirst({ where: { id: clienteId } });
      if (!cli) throw new DomainError('Cliente inexistente.');
    }
    if (id) {
      const antes = await ctx.db.proyecto.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Proyecto inexistente.');
      await ctx.db.proyecto.update({ where: { id }, data: { nombre, codigo, clienteId } });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Proyecto', entidadId: id, accion: 'EDITAR', antes, despues: { nombre, codigo, clienteId } });
    } else {
      const nuevo = await ctx.db.proyecto.create({ data: { nombre, codigo, clienteId } as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Proyecto', entidadId: nuevo.id, accion: 'CREAR', despues: { nombre, codigo, clienteId } });
    }
  } catch (err) {
    volver(slug, 'proyectos', mensaje(err));
  }
  volver(slug, 'proyectos');
}

export async function toggleProyecto(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const p = await ctx.db.proyecto.findFirst({ where: { id } });
    if (!p) throw new DomainError('Proyecto inexistente.');
    await ctx.db.proyecto.update({ where: { id }, data: { activo: !p.activo } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'Proyecto', entidadId: id, accion: p.activo ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'proyectos', mensaje(err));
  }
  volver(slug, 'proyectos');
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

// ---------- Reglas de asignación ----------

export async function guardarRegla(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id') ?? '');
    const nombre = String(formData.get('nombre') ?? '').trim();
    if (!nombre) throw new DomainError('El nombre es obligatorio.');
    const prioridadRaw = String(formData.get('prioridad') ?? '').trim();
    const prioridad = prioridadRaw === '' || Number.isNaN(Number(prioridadRaw)) ? 100 : Number(prioridadRaw);
    const v = (k: string) => { const s = String(formData.get(k) ?? '').trim(); return s || null; };
    const accion = String(formData.get('accion') ?? 'ASIGNAR') === 'OBSERVAR' ? 'OBSERVAR' : 'ASIGNAR';
    // Una regla OBSERVAR (descarte) no lleva imputación: limpiamos los campos de acción.
    const data = {
      nombre, prioridad, accion,
      cargadoPorId: v('cargadoPorId'), cuit: v('cuit'), canal: v('canal'), palabraClave: v('palabraClave'),
      categoriaId: accion === 'OBSERVAR' ? null : v('categoriaId'),
      distribucionId: accion === 'OBSERVAR' ? null : v('distribucionId'),
      centroCostoId: accion === 'OBSERVAR' ? null : v('centroCostoId'),
      clienteId: accion === 'OBSERVAR' ? null : v('clienteId'),
      proyectoId: accion === 'OBSERVAR' ? null : v('proyectoId'),
    };
    if (![data.cargadoPorId, data.cuit, data.canal, data.palabraClave].some(Boolean)) {
      throw new DomainError('La regla necesita al menos una condición.');
    }
    if (accion === 'ASIGNAR' && (!data.categoriaId || !(data.distribucionId || data.centroCostoId))) {
      throw new DomainError('La acción Asignar necesita categoría y (plantilla de distribución o centro de costo).');
    }
    if ((data.clienteId || data.proyectoId) && !data.centroCostoId) {
      throw new DomainError('Cliente/proyecto requieren un centro de costo (línea única).');
    }
    // Las columnas de acción no tienen FK (por diseño): validar existencia acá,
    // como en guardarContraparte, para que una regla no preasigne a maestros
    // inexistentes/de otra empresa (la auto-asignación del pipeline no revalida).
    if (data.categoriaId && !(await ctx.db.categoria.findFirst({ where: { id: data.categoriaId } }))) {
      throw new DomainError('Categoría inexistente.');
    }
    if (data.distribucionId && !(await ctx.db.plantillaDistribucion.findFirst({ where: { id: data.distribucionId } }))) {
      throw new DomainError('Plantilla de distribución inexistente.');
    }
    if (data.centroCostoId && !(await ctx.db.centroCosto.findFirst({ where: { id: data.centroCostoId } }))) {
      throw new DomainError('Centro de costo inexistente.');
    }
    if (data.clienteId) {
      const cli = await ctx.db.cliente.findFirst({ where: { id: data.clienteId } });
      if (!cli) throw new DomainError('Cliente inexistente.');
      // Árbol de asignación: un cliente clasificado sólo vale bajo su centro.
      if (cli.centroCostoId && cli.centroCostoId !== data.centroCostoId) {
        throw new DomainError(`El cliente «${cli.nombre}» pertenece a otro centro de costo.`);
      }
    }
    if (data.proyectoId) {
      const pr = await ctx.db.proyecto.findFirst({ where: { id: data.proyectoId } });
      if (!pr) throw new DomainError('Proyecto inexistente.');
      // Ídem: un proyecto clasificado sólo vale bajo su cliente.
      if (pr.clienteId && pr.clienteId !== data.clienteId) {
        throw new DomainError(`El proyecto «${pr.nombre}» pertenece a otro cliente.`);
      }
    }
    if (id) {
      const antes = await ctx.db.reglaAsignacion.findFirst({ where: { id } });
      if (!antes) throw new DomainError('Regla inexistente.');
      await ctx.db.reglaAsignacion.update({ where: { id }, data });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: id, accion: 'EDITAR', antes, despues: data });
    } else {
      const nueva = await ctx.db.reglaAsignacion.create({ data: data as never });
      await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: nueva.id, accion: 'CREAR', despues: data });
    }
  } catch (err) {
    volver(slug, 'reglas', mensaje(err));
  }
  volver(slug, 'reglas');
}

export async function toggleRegla(formData: FormData): Promise<void> {
  const slug = String(formData.get('empresaSlug'));
  try {
    const ctx = await requireEmpresa(slug, 'VALIDADOR');
    const id = String(formData.get('id'));
    const r = await ctx.db.reglaAsignacion.findFirst({ where: { id } });
    if (!r) throw new DomainError('Regla inexistente.');
    await ctx.db.reglaAsignacion.update({ where: { id }, data: { activa: !r.activa } });
    await writeAudit(ctx.db, { usuarioId: ctx.usuario.id, entidad: 'ReglaAsignacion', entidadId: id, accion: r.activa ? 'DESACTIVAR' : 'ACTIVAR' });
  } catch (err) {
    volver(slug, 'reglas', mensaje(err));
  }
  volver(slug, 'reglas');
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
    const prIds = formData.getAll('linea_proyectoId').map(String);
    const pcts = formData.getAll('linea_porcentaje').map((v) => Number(String(v).replace(',', '.')));
    const lineas = ccIds
      .map((cc, i) => ({ centroCostoId: cc, clienteId: cpIds[i] || null, proyectoId: prIds[i] || null, porcentaje: pcts[i] }))
      .filter((l) => l.centroCostoId && l.porcentaje > 0);
    validarDistribucion(lineas);
    for (const l of lineas) {
      if (!(await ctx.db.centroCosto.findFirst({ where: { id: l.centroCostoId } }))) {
        throw new DomainError('Centro de costo inexistente en una línea.');
      }
      if (l.clienteId && !(await ctx.db.cliente.findFirst({ where: { id: l.clienteId } }))) {
        throw new DomainError('Cliente inexistente en una línea.');
      }
      if (l.proyectoId && !(await ctx.db.proyecto.findFirst({ where: { id: l.proyectoId } }))) {
        throw new DomainError('Proyecto inexistente en una línea.');
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
