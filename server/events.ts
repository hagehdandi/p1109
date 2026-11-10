import type { Response } from 'express';

// Koneksi Server-Sent Events per pengguna, dipakai untuk memberi tahu klien saat ada email baru.
const clients = new Map<number, Set<Response>>();

export function subscribe(userId: number, res: Response): () => void {
  const set = clients.get(userId) ?? new Set<Response>();
  clients.set(userId, set);
  set.add(res);
  return () => {
    set.delete(res);
    if (set.size === 0) clients.delete(userId);
  };
}

export function notify(userId: number): void {
  for (const res of clients.get(userId) ?? []) {
    res.write(`event: mail\ndata: ${Date.now()}\n\n`);
  }
}
