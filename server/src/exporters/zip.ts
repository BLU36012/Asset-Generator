import { ZipArchive } from 'archiver';

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

export function zip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.on('warning', reject);
    for (const entry of entries) {
      archive.append(typeof entry.data === 'string' ? entry.data : Buffer.from(entry.data), { name: entry.name });
    }
    void archive.finalize();
  });
}
