// Chequeo de duplicados de proyecto por combo (cliente, nombre). Complementa
// el índice único del schema: en Postgres los NULL no chocan entre sí, así que
// dos proyectos "sin clasificar" con el mismo nombre pasarían el índice.
type DbProyectos = {
  proyecto: {
    findFirst(args: {
      where: { nombre: string; clienteId: string | null; id?: { not: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

export async function proyectoDuplicado(
  db: DbProyectos,
  { nombre, clienteId, ignorarId }: { nombre: string; clienteId: string | null; ignorarId?: string },
): Promise<boolean> {
  const existente = await db.proyecto.findFirst({
    where: { nombre, clienteId, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  return existente != null;
}
