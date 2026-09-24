import { describe, it, expect } from 'vitest';
import { subirEnTandas, mensajeSinRespuesta, TAMANO_TANDA } from '@/lib/carga/subir-en-tandas';

// La UploadZone manda los archivos en tandas de 5 a la server action. Si algo
// delante de la app (Cloudflare, proxy) rechaza el POST, Next resuelve la
// action con `undefined` en vez de tirar: el cliente tiene que mostrarlo como
// error y no reventar la página ("Cannot read properties of undefined").

const archivo = (name: string) => ({ name });
const nombres = (n: number, prefijo = 'f') => Array.from({ length: n }, (_, i) => archivo(`${prefijo}${i + 1}.pdf`));

describe('subirEnTandas', () => {
  it('parte en tandas de 5, reusa el loteId de la primera y suma resultados', async () => {
    const llamadas: Array<{ nombres: string[]; loteId?: string }> = [];
    const r = await subirEnTandas(nombres(12), async (tanda, loteId) => {
      llamadas.push({ nombres: tanda.map((f) => f.name), loteId });
      return { ok: tanda.length - 1, errores: [`${tanda[0].name}: falló`], loteId: 'L1' };
    });
    expect(TAMANO_TANDA).toBe(5);
    expect(llamadas.map((c) => c.nombres.length)).toEqual([5, 5, 2]);
    expect(llamadas.map((c) => c.loteId)).toEqual([undefined, 'L1', 'L1']);
    expect(r).toEqual({ ok: 9, errores: ['f1.pdf: falló', 'f6.pdf: falló', 'f11.pdf: falló'], loteId: 'L1' });
  });

  it('si la action no devuelve nada, informa el error con los archivos y no sigue mandando', async () => {
    let llamadas = 0;
    const r = await subirEnTandas(nombres(7), async () => {
      llamadas++;
      return undefined;
    });
    expect(llamadas).toBe(1);
    expect(r.ok).toBe(0);
    expect(r.loteId).toBeUndefined();
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toContain('f1.pdf');
    expect(r.errores[0]).toContain('f5.pdf');
    // los que no se llegaron a mandar también se nombran para que el usuario los reintente
    expect(r.errores[0]).toContain('f6.pdf');
    expect(r.errores[0]).toContain('f7.pdf');
  });

  it('una tanda posterior sin respuesta conserva lo ya subido', async () => {
    let n = 0;
    const r = await subirEnTandas(nombres(8), async (tanda) => {
      n++;
      return n === 1 ? { ok: tanda.length, errores: [], loteId: 'L2' } : undefined;
    });
    expect(r.ok).toBe(5);
    expect(r.loteId).toBe('L2');
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toContain('f6.pdf');
  });
});

describe('subirEnTandas cuando la action tira', () => {
  // Un corte de red, un 5xx del túnel o un timeout no resuelven `undefined`:
  // la llamada tira. Antes eso escapaba del componente y el usuario no veía
  // ningún cartel (la subida quedaba a medias en silencio).
  it('informa el error con los archivos que faltan y no sigue mandando', async () => {
    let n = 0;
    const r = await subirEnTandas(nombres(8), async (tanda) => {
      n++;
      if (n === 1) return { ok: tanda.length, errores: [], loteId: 'L3' };
      throw new TypeError('Failed to fetch');
    });
    expect(n).toBe(2);
    expect(r.ok).toBe(5);
    expect(r.loteId).toBe('L3');
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toContain('f6.pdf');
    expect(r.errores[0]).toContain('f8.pdf');
    expect(r.errores[0]).not.toContain('f5.pdf');
    expect(r.errores[0]).toContain('Failed to fetch');
  });
});

describe('mensajeSinRespuesta', () => {
  it('explica que el servidor no respondió y lista los archivos', () => {
    const m = mensajeSinRespuesta(['a.pdf', 'b.jpg']);
    expect(m).toMatch(/no (devolvió|hubo) respuesta/i);
    expect(m).toContain('a.pdf');
    expect(m).toContain('b.jpg');
  });
});
