// Page title with the ledger double-rule ornament.
export function PageHeader({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="reveal reveal-1 mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="titulo-pagina">{titulo}</h1>
        <span className="rule-doble" />
        {descripcion && <p className="mt-2 text-sm text-ink-mute max-w-2xl">{descripcion}</p>}
      </div>
      {acciones && <div className="flex items-center gap-2">{acciones}</div>}
    </div>
  );
}
