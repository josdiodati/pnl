// Split lógico del PDF multi-recibo: no se generan archivos por página, solo
// se cuenta y se extrae el texto de la página pedida (unpdf, igual que
// AnthropicExtractor.tryPdfText pero sin mergePages).

export async function contarPaginasPdf(buffer: Buffer): Promise<number> {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  return doc.numPages;
}

export async function textoDePagina(buffer: Buffer, pagina: number): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    if (pagina < 1 || pagina > doc.numPages) return null;
    const { text } = await extractText(doc, { mergePages: false });
    return text[pagina - 1] ?? null;
  } catch {
    return null;
  }
}
