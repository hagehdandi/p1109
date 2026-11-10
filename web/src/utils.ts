import type { Addr, View } from './api';

const LOCALE = 'id-ID';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatListDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatRelative(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return 'baru saja';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / (86400 * 30)), 'month');
}

export function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMessageDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time} (${formatRelative(ts)})`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 0 })} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} GB`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const displayName = (a: Addr) => a.name || a.address;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export const isEmail = (value: string) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(value);

export function parseAddressInput(raw: string): Addr[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*)<([^>]+)>$/.exec(s);
      if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim().toLowerCase() };
      return { name: '', address: s.toLowerCase() };
    });
}

const PALETTE = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83', '#c5221f', '#b06000', '#3367d6', '#8430ce'];

export function colorFor(key: string): string {
  let hash = 0;
  for (const ch of key.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Campurkan warna dengan putih (warna datar, bukan gradien) untuk latar chip label. */
export function tint(hex: string, amount = 0.86): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const VIEW_TITLES: Record<View, string> = {
  inbox: 'Kotak Masuk',
  starred: 'Berbintang',
  sent: 'Terkirim',
  drafts: 'Draf',
  all: 'Semua Email',
  spam: 'Spam',
  trash: 'Sampah',
  label: 'Label',
  search: 'Hasil penelusuran',
};

export function signatureHtml(signature: string): string {
  if (!signature.trim()) return '';
  return `<div class="dm-signature">-- <br>${escapeHtml(signature).replace(/\n/g, '<br>')}</div>`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}
