import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Original files are IMMUTABLE: put() never overwrites, there is no delete.
// Re-uploading a different file is a new movement, not a replacement.

export type PutMeta = { filename: string; mime: string; empresaId: string };

export interface FileStorage {
  put(buffer: Buffer, meta: PutMeta): Promise<{ key: string; hash: string }>;
  get(key: string): Promise<Buffer>;
  /** URL the browser can hit to view the file (auth enforced by the route). */
  getSignedUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

class LocalFileStorage implements FileStorage {
  constructor(private baseDir: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    if (!full.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(buffer: Buffer, meta: PutMeta): Promise<{ key: string; hash: string }> {
    const safeName = meta.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    // Key embeds the owning company: the file-serving route checks it.
    const key = `${meta.empresaId}/${randomUUID()}__${safeName}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer, { flag: 'wx' }); // wx: fail if exists (immutability)
    return { key, hash: sha256(buffer) };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/api/archivos/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

// FILE_STORAGE=s3 is part of the interface design but intentionally not
// implemented in the MVP; LocalFileStorage covers dev and single-VM deploys.
export function getFileStorage(): FileStorage {
  const mode = process.env.FILE_STORAGE ?? 'local';
  if (mode === 's3') {
    throw new Error('FILE_STORAGE=s3 todavía no está implementado; usá local.');
  }
  return new LocalFileStorage(process.env.FILE_STORAGE_DIR ?? './storage');
}
