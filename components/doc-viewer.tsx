'use client';

import { useState } from 'react';

// Original-document viewer for the side-by-side validation screen.
// PDFs use the browser's native viewer (zoom/pages included); images get
// manual zoom + rotation controls (needed to validate paper photos).
export function DocViewer({ url, mime, nombre }: { url: string; mime: string; nombre: string }) {
  const [zoom, setZoom] = useState(1);
  const [rotacion, setRotacion] = useState(0);

  if (mime === 'application/pdf') {
    return (
      <div className="h-full min-h-[70vh] flex flex-col">
        <div className="text-xs text-slate-500 px-1 pb-1 truncate">{nombre}</div>
        <iframe src={url} title={nombre} className="flex-1 w-full rounded border border-slate-200 bg-slate-50" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-[70vh] flex flex-col">
      <div className="flex items-center gap-2 pb-1">
        <span className="text-xs text-slate-500 truncate flex-1">{nombre}</span>
        <button type="button" className="btn-secondary text-xs" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>−</button>
        <span className="text-xs tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn-secondary text-xs" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>+</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setRotacion((r) => (r + 90) % 360)}>⟳ Rotar</button>
      </div>
      <div className="flex-1 overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={nombre}
          style={{ transform: `scale(${zoom}) rotate(${rotacion}deg)`, transformOrigin: 'top left' }}
          className="max-w-none"
        />
      </div>
    </div>
  );
}
