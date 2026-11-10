import type { QueryClient } from '@tanstack/react-query';

export type Addr = { name: string; address: string };
export type View = 'inbox' | 'starred' | 'sent' | 'drafts' | 'all' | 'spam' | 'trash' | 'label' | 'search';
export type Label = { id: number; name: string; color: string };
export type AttachmentInfo = { id: number; filename: string; size: number; contentType: string };

export type AppConfig = {
  appName: string;
  domain: string;
  allowSignup: boolean;
  demo: boolean;
  smtp: { enabled: boolean; hostname: string; port: number };
  outboundMode: 'relay' | 'direct' | 'disabled';
};

export type User = { id: number; email: string; name: string; color: string; signature: string };
export type Me = User & { storageUsed: number; storageQuota: number };

export type ThreadSummary = {
  threadId: string;
  draftId?: number;
  count: number;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  date: number;
  subject: string;
  snippet: string;
  participants: { name: string; address: string; me: boolean; unread: boolean }[];
  recipients: string[];
  labels: Label[];
  inInbox: boolean;
};

export type ThreadList = { items: ThreadSummary[]; total: number; page: number; pageSize: number };

export type MessageDetail = {
  id: number;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  snippet: string;
  html: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  folder: string;
  isMine: boolean;
  deliveryStatus: string | null;
  labels: number[];
  attachments: AttachmentInfo[];
};

export type ThreadDetail = {
  threadId: string;
  subject: string;
  labels: Label[];
  inInbox: boolean;
  folders: string[];
  messages: MessageDetail[];
};

export type Counts = { inbox: number; spam: number; drafts: number; labels: Record<string, number> };

export type DraftDetail = {
  id: number;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  replyToId: number | null;
  attachments: AttachmentInfo[];
};

export type ThreadAction =
  | 'archive'
  | 'inbox'
  | 'trash'
  | 'delete'
  | 'spam'
  | 'read'
  | 'unread'
  | 'star'
  | 'unstar'
  | 'label_add'
  | 'label_remove';

export type Snapshot = { id: number; folder: string; prev_folder: string | null; is_read: number; is_starred: number };

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'dmails' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi Anda.', 0);
  }
  if (!res.ok) {
    let message = `Terjadi kesalahan (${res.status}).`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // respons bukan JSON
    }
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('dmails:unauthorized'));
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

export function invalidateMail(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['threads'] });
  void qc.invalidateQueries({ queryKey: ['thread'] });
  void qc.invalidateQueries({ queryKey: ['counts'] });
  void qc.invalidateQueries({ queryKey: ['me'] });
}
