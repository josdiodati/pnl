import { PNG } from 'pngjs';

export async function decodePngToRgba(
  png: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    new PNG().parse(png, (err, parsed) => {
      if (err) reject(err);
      else resolve({ data: parsed.data, width: parsed.width, height: parsed.height });
    });
  });
}
