import crypto from 'node:crypto';
import { config } from '../config';
import { db, type UserRow } from '../db';
import { snippetOf } from './format';

export type Addr = { name: string; address: string };
export type Folder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash';
export const FOLDERS: readonly Folder[] = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'];
export type View = 'inbox' | 'starred' | 'sent' | 'drafts' | 'all' | 'spam' | 'trash' | 'label' | 'search';
export const VIEWS: readonly View[] = ['inbox', 'starred', 'sent', 'drafts', 'all', 'spam', 'trash', 'label', 'search'];

export type MessageRow = {
  id: number;
  user_id: number;
  thread_id: string;
  folder: Folder;
  prev_folder: Folder | null;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string;
  from_name: string;
  from_addr: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  subject: string;
  snippet: string;
  body_html: string;
  body_text: string;
  is_read: number;
  is_starred: number;
  has_attachments: number;
  date: number;
  delivery_status: string | null;
  reply_to_id: number | null;
  created_at: number;
};

export type AttachmentRow = {
  id: number;
  user_id: number;
  message_id: number | null;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  content_id: string | null;
  created_at: number;
};

export type AttachmentInfo = { id: number; filename: string; size: number; contentType: string };
export type FileInput = { filename: string; contentType: string; data: Buffer; contentId?: string | null };
export type LabelInfo = { id: number; name: string; color: string };

// Pesan "normal": semua kecuali sampah, spam, dan draf.
const NORMAL_SCOPE = `folder NOT IN ('trash', 'spam', 'drafts')`;
const ESC = `ESCAPE '\\'`;

export const placeholders = (n: number) => Array(n).fill('?').join(', ');
const likeValue = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function parseAddrs(json: string): Addr[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const newThreadId = () => crypto.randomBytes(9).toString('base64url');
export const newMessageId = () => `<${crypto.randomUUID()}@${config.domain}>`;
export const splitRefs = (refs: string | null | undefined) => (refs ?? '').split(/\s+/).filter(Boolean);

/** Cari percakapan pengguna yang memuat salah satu Message-ID; jika tidak ada, buat percakapan baru. */
export function resolveThreadId(userId: number, candidates: (string | null | undefined)[]): string {
  const ids = [...new Set(candidates.filter((c): c is string => !!c))];
  if (ids.length) {
    const row = db
      .prepare(
        `SELECT thread_id FROM messages WHERE user_id = ? AND message_id IN (${placeholders(ids.length)}) ORDER BY date DESC LIMIT 1`,
      )
      .get(userId, ...ids) as { thread_id: string } | undefined;
    if (row) return row.thread_id;
  }
  return newThreadId();
}

export function threadingFor(userId: number, replyToId?: number | null) {
  if (replyToId) {
    const orig = db
      .prepare('SELECT thread_id, message_id, refs FROM messages WHERE id = ? AND user_id = ?')
      .get(replyToId, userId) as Pick<MessageRow, 'thread_id' | 'message_id' | 'refs'> | undefined;
    if (orig) {
      const refs = [...splitRefs(orig.refs), ...(orig.message_id ? [orig.message_id] : [])].slice(-30);
      return { threadId: orig.thread_id, inReplyTo: orig.message_id, refs, replyToId };
    }
  }
  return { threadId: newThreadId(), inReplyTo: null as string | null, refs: [] as string[], replyToId: null as number | null };
}

export type NewMessage = {
  userId: number;
  threadId: string;
  folder: Folder;
  messageId?: string | null;
  inReplyTo?: string | null;
  refs?: string[];
  from: Addr;
  to: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject: string;
  html: string;
  text: string;
  isRead?: boolean;
  isStarred?: boolean;
  date?: number;
  deliveryStatus?: string | null;
  replyToId?: number | null;
};

const insertStmt = db.prepare(`
  INSERT INTO messages (user_id, thread_id, folder, message_id, in_reply_to, refs, from_name, from_addr, to_json, cc_json,
    bcc_json, subject, snippet, body_html, body_text, is_read, is_starred, date, delivery_status, reply_to_id, created_at)
  VALUES (@userId, @threadId, @folder, @messageId, @inReplyTo, @refs, @fromName, @fromAddr, @to, @cc,
    @bcc, @subject, @snippet, @html, @text, @isRead, @isStarred, @date, @deliveryStatus, @replyToId, @createdAt)`);

export function insertMessage(m: NewMessage): number {
  const now = Date.now();
  const info = insertStmt.run({
    userId: m.userId,
    threadId: m.threadId,
    folder: m.folder,
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    refs: (m.refs ?? []).join(' '),
    fromName: m.from.name,
    fromAddr: m.from.address.toLowerCase(),
    to: JSON.stringify(m.to),
    cc: JSON.stringify(m.cc ?? []),
    bcc: JSON.stringify(m.bcc ?? []),
    subject: m.subject,
    snippet: snippetOf(m.text),
    html: m.html,
    text: m.text,
    isRead: m.isRead ? 1 : 0,
    isStarred: m.isStarred ? 1 : 0,
    date: m.date ?? now,
    deliveryStatus: m.deliveryStatus ?? null,
    replyToId: m.replyToId ?? null,
    createdAt: now,
  });
  return Number(info.lastInsertRowid);
}

/* ---------------------------------------------------------------- lampiran */

export const toAttachmentInfo = (row: Pick<AttachmentRow, 'id' | 'filename' | 'size' | 'content_type'>): AttachmentInfo => ({
  id: row.id,
  filename: row.filename,
  size: row.size,
  contentType: row.content_type,
});

export function storeBlob(data: Buffer): string {
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  db.prepare('INSERT OR IGNORE INTO blobs (sha256, size, data) VALUES (?, ?, ?)').run(sha, data.length, data);
  return sha;
}

const insertAttachment = db.prepare(
  'INSERT INTO attachments (user_id, message_id, filename, content_type, size, sha256, content_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);

export function addAttachment(userId: number, messageId: number | null, file: FileInput): AttachmentInfo {
  const sha = storeBlob(file.data);
  const info = insertAttachment.run(userId, messageId, file.filename, file.contentType, file.data.length, sha, file.contentId ?? null, Date.now());
  return { id: Number(info.lastInsertRowid), filename: file.filename, size: file.data.length, contentType: file.contentType };
}

export function loadAttachmentFiles(messageId: number): FileInput[] {
  const rows = db
    .prepare(
      'SELECT a.filename, a.content_type, a.content_id, b.data FROM attachments a JOIN blobs b ON b.sha256 = a.sha256 WHERE a.message_id = ? ORDER BY a.id',
    )
    .all(messageId) as { filename: string; content_type: string; content_id: string | null; data: Buffer }[];
  return rows.map((r) => ({ filename: r.filename, contentType: r.content_type, contentId: r.content_id, data: r.data }));
}

export function refreshHasAttachments(messageId: number): void {
  db.prepare('UPDATE messages SET has_attachments = EXISTS (SELECT 1 FROM attachments WHERE message_id = ?) WHERE id = ?').run(
    messageId,
    messageId,
  );
}

/** Hubungkan lampiran (baru diunggah atau sudah milik pesan ini) dan hapus yang tidak dipakai lagi. */
export function syncAttachments(userId: number, messageId: number, ids: number[]): void {
  const keep = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (keep.length) {
    db.prepare(
      `UPDATE attachments SET message_id = ? WHERE user_id = ? AND id IN (${placeholders(keep.length)}) AND (message_id IS NULL OR message_id = ?)`,
    ).run(messageId, userId, ...keep, messageId);
    db.prepare(`DELETE FROM attachments WHERE message_id = ? AND id NOT IN (${placeholders(keep.length)})`).run(messageId, ...keep);
  } else {
    db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId);
  }
  refreshHasAttachments(messageId);
}

/** Salin lampiran pesan (untuk "Teruskan") menjadi lampiran baru yang belum terikat ke pesan. */
export function copyAttachments(userId: number, fromMessageId: number): AttachmentInfo[] {
  const owned = db.prepare('SELECT 1 FROM messages WHERE id = ? AND user_id = ?').get(fromMessageId, userId);
  if (!owned) return [];
  const rows = db.prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY id').all(fromMessageId) as AttachmentRow[];
  return rows.map((r) => {
    const info = insertAttachment.run(userId, null, r.filename, r.content_type, r.size, r.sha256, r.content_id, Date.now());
    return { id: Number(info.lastInsertRowid), filename: r.filename, size: r.size, contentType: r.content_type };
  });
}

export function gcBlobs(): void {
  db.prepare('DELETE FROM blobs WHERE sha256 NOT IN (SELECT sha256 FROM attachments)').run();
}

export function cleanup(): void {
  db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?').run(Date.now() - 24 * 3600_000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  gcBlobs();
}

/* ------------------------------------------------------- daftar percakapan */

type Scope = { match: string; params: unknown[]; scope: string };

function searchScope(userId: number, q: string): Scope {
  const tokens = q.match(/[^\s"]+:"[^"]*"|"[^"]*"|\S+/g) ?? [];
  const parts: string[] = [];
  const params: unknown[] = [];
  let folder: string | null = null;
  const text = (value: string) => {
    parts.push(
      `(subject LIKE ? ${ESC} OR body_text LIKE ? ${ESC} OR from_name LIKE ? ${ESC} OR from_addr LIKE ? ${ESC} OR to_json LIKE ? ${ESC})`,
    );
    params.push(...Array(5).fill(likeValue(value)));
  };
  for (const token of tokens) {
    const m = /^([a-z]+):(.+)$/i.exec(token);
    const key = m?.[1].toLowerCase();
    const value = (m ? m[2] : token).replace(/^"|"$/g, '').trim();
    if (!value) continue;
    switch (key) {
      case 'from':
      case 'dari':
        parts.push(`(from_name LIKE ? ${ESC} OR from_addr LIKE ? ${ESC})`);
        params.push(likeValue(value), likeValue(value));
        break;
      case 'to':
      case 'kepada':
        parts.push(`(to_json LIKE ? ${ESC} OR cc_json LIKE ? ${ESC} OR bcc_json LIKE ? ${ESC})`);
        params.push(likeValue(value), likeValue(value), likeValue(value));
        break;
      case 'subject':
      case 'subjek':
        parts.push(`subject LIKE ? ${ESC}`);
        params.push(likeValue(value));
        break;
      case 'has':
        if (/^(attachment|lampiran)$/i.test(value)) parts.push('has_attachments = 1');
        else text(token);
        break;
      case 'is': {
        const v = value.toLowerCase();
        if (v === 'unread') parts.push('is_read = 0');
        else if (v === 'read') parts.push('is_read = 1');
        else if (v === 'starred') parts.push('is_starred = 1');
        else text(token);
        break;
      }
      case 'in':
        folder = value.toLowerCase();
        break;
      case 'label':
        parts.push(
          'id IN (SELECT ml.message_id FROM message_labels ml JOIN labels l ON l.id = ml.label_id WHERE l.user_id = ? AND l.name = ? COLLATE NOCASE)',
        );
        params.push(userId, value);
        break;
      default:
        text(m ? token : value);
    }
  }
  let scope = NORMAL_SCOPE;
  if (folder === 'trash') scope = `folder = 'trash'`;
  else if (folder === 'spam') scope = `folder = 'spam'`;
  else if (folder === 'anywhere') scope = `folder != 'drafts'`;
  else if (folder === 'inbox') parts.push(`folder = 'inbox'`);
  else if (folder === 'sent') parts.push(`folder = 'sent'`);
  parts.push(scope);
  return { match: parts.join(' AND '), params, scope };
}

function viewScope(userId: number, view: View, labelId?: number, q?: string): Scope {
  switch (view) {
    case 'inbox':
      return { match: `folder = 'inbox'`, params: [], scope: NORMAL_SCOPE };
    case 'starred':
      return { match: `is_starred = 1 AND ${NORMAL_SCOPE}`, params: [], scope: NORMAL_SCOPE };
    case 'sent':
      return { match: `folder = 'sent'`, params: [], scope: NORMAL_SCOPE };
    case 'spam':
      return { match: `folder = 'spam'`, params: [], scope: `folder = 'spam'` };
    case 'trash':
      return { match: `folder = 'trash'`, params: [], scope: `folder = 'trash'` };
    case 'label':
      return {
        match: `${NORMAL_SCOPE} AND id IN (SELECT message_id FROM message_labels WHERE label_id = ?)`,
        params: [labelId ?? 0],
        scope: NORMAL_SCOPE,
      };
    case 'search':
      return searchScope(userId, q ?? '');
    default:
      return { match: NORMAL_SCOPE, params: [], scope: NORMAL_SCOPE };
  }
}

export function scopeFor(userId: number, view: View, q?: string): string {
  if (view === 'trash') return `folder = 'trash'`;
  if (view === 'spam') return `folder = 'spam'`;
  if (view === 'search') return searchScope(userId, q ?? '').scope;
  return NORMAL_SCOPE;
}

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
  labels: LabelInfo[];
  inInbox: boolean;
};

export function listThreads(
  user: UserRow,
  opts: { view: View; labelId?: number; q?: string; page: number; pageSize: number },
): { items: ThreadSummary[]; total: number; page: number; pageSize: number } {
  const { page, pageSize } = opts;
  if (opts.view === 'drafts') return listDrafts(user, page, pageSize);

  const s = viewScope(user.id, opts.view, opts.labelId, opts.q);
  const cte = `WITH matched AS (SELECT DISTINCT thread_id FROM messages WHERE user_id = ? AND (${s.match})),
    scoped AS (SELECT m.* FROM messages m JOIN matched t ON t.thread_id = m.thread_id WHERE m.user_id = ? AND (${s.scope}))`;
  const params = [user.id, ...s.params, user.id];
  const total = (db.prepare(`${cte} SELECT COUNT(DISTINCT thread_id) AS n FROM scoped`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `${cte} SELECT thread_id, MAX(date) AS last_date, COUNT(*) AS cnt, SUM(is_read = 0) AS unread, MAX(is_starred) AS starred,
        MAX(has_attachments) AS att, MAX(folder = 'inbox') AS in_inbox
      FROM scoped GROUP BY thread_id ORDER BY last_date DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as {
    thread_id: string;
    last_date: number;
    cnt: number;
    unread: number;
    starred: number;
    att: number;
    in_inbox: number;
  }[];
  if (!rows.length) return { items: [], total, page, pageSize };

  const ids = rows.map((r) => r.thread_id);
  type Lite = Pick<MessageRow, 'id' | 'thread_id' | 'from_name' | 'from_addr' | 'to_json' | 'subject' | 'snippet' | 'is_read'>;
  const msgs = db
    .prepare(
      `SELECT id, thread_id, from_name, from_addr, to_json, subject, snippet, is_read FROM messages
       WHERE user_id = ? AND thread_id IN (${placeholders(ids.length)}) AND (${s.scope}) ORDER BY date ASC, id ASC`,
    )
    .all(user.id, ...ids) as Lite[];
  const labelRows = db
    .prepare(
      `SELECT DISTINCT m.thread_id, l.id, l.name, l.color FROM messages m
       JOIN message_labels ml ON ml.message_id = m.id JOIN labels l ON l.id = ml.label_id
       WHERE m.user_id = ? AND m.thread_id IN (${placeholders(ids.length)}) AND (${s.scope.replace(/folder/g, 'm.folder')})
       ORDER BY l.name COLLATE NOCASE`,
    )
    .all(user.id, ...ids) as (LabelInfo & { thread_id: string })[];

  const me = user.email.toLowerCase();
  const byThread = new Map<string, Lite[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  const labelsByThread = new Map<string, LabelInfo[]>();
  for (const l of labelRows) {
    labelsByThread.set(l.thread_id, [...(labelsByThread.get(l.thread_id) ?? []), { id: l.id, name: l.name, color: l.color }]);
  }

  const items = rows.map((r): ThreadSummary => {
    const list = byThread.get(r.thread_id) ?? [];
    const first = list[0];
    const latest = list[list.length - 1];
    const participants: ThreadSummary['participants'] = [];
    for (const m of list) {
      const address = m.from_addr.toLowerCase();
      const existing = participants.find((p) => p.address === address);
      if (existing) existing.unread ||= !m.is_read;
      else participants.push({ name: m.from_name || m.from_addr, address, me: address === me, unread: !m.is_read });
    }
    const lastMine = [...list].reverse().find((m) => m.from_addr.toLowerCase() === me);
    return {
      threadId: r.thread_id,
      count: r.cnt,
      unread: r.unread > 0,
      starred: r.starred > 0,
      hasAttachments: r.att > 0,
      date: r.last_date,
      subject: first?.subject ?? '',
      snippet: latest?.snippet ?? '',
      participants,
      recipients: lastMine ? parseAddrs(lastMine.to_json).map((a) => a.name || a.address) : [],
      labels: labelsByThread.get(r.thread_id) ?? [],
      inInbox: r.in_inbox > 0,
    };
  });
  return { items, total, page, pageSize };
}

function listDrafts(user: UserRow, page: number, pageSize: number) {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND folder = 'drafts'`).get(user.id) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM messages WHERE user_id = ? AND folder = 'drafts' ORDER BY date DESC LIMIT ? OFFSET ?`)
    .all(user.id, pageSize, (page - 1) * pageSize) as MessageRow[];
  const items = rows.map(
    (r): ThreadSummary => ({
      threadId: r.thread_id,
      draftId: r.id,
      count: 1,
      unread: false,
      starred: r.is_starred === 1,
      hasAttachments: r.has_attachments === 1,
      date: r.date,
      subject: r.subject,
      snippet: r.snippet,
      participants: [],
      recipients: [...parseAddrs(r.to_json), ...parseAddrs(r.cc_json)].map((a) => a.name || a.address),
      labels: [],
      inInbox: false,
    }),
  );
  return { items, total, page, pageSize };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getThread(user: UserRow, threadId: string, view: View, q?: string) {
  const load = (scope: string) =>
    db
      .prepare(`SELECT * FROM messages WHERE user_id = ? AND thread_id = ? AND (${scope}) ORDER BY date ASC, id ASC`)
      .all(user.id, threadId) as MessageRow[];
  let rows = load(scopeFor(user.id, view, q));
  if (!rows.length) rows = load(`folder != 'drafts'`);
  if (!rows.length) return null;

  const ids = rows.map((r) => r.id);
  const atts = db
    .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders(ids.length)}) ORDER BY id`)
    .all(...ids) as AttachmentRow[];
  const labelRows = db
    .prepare(
      `SELECT ml.message_id, l.id, l.name, l.color FROM message_labels ml JOIN labels l ON l.id = ml.label_id
       WHERE ml.message_id IN (${placeholders(ids.length)}) ORDER BY l.name COLLATE NOCASE`,
    )
    .all(...ids) as (LabelInfo & { message_id: number })[];

  const me = user.email.toLowerCase();
  const messages = rows.map((r) => {
    const own = atts.filter((a) => a.message_id === r.id);
    const inline = new Set<number>();
    const html = r.body_html.replace(/cid:([^"'\s)>]+)/gi, (match, cid: string) => {
      const target = own.find((a) => a.content_id && a.content_id.toLowerCase() === safeDecode(cid).toLowerCase());
      if (!target) return match;
      inline.add(target.id);
      return `/api/attachments/${target.id}`;
    });
    const isMine = r.from_addr.toLowerCase() === me;
    return {
      id: r.id,
      from: { name: r.from_name, address: r.from_addr },
      to: parseAddrs(r.to_json),
      cc: parseAddrs(r.cc_json),
      bcc: isMine ? parseAddrs(r.bcc_json) : [],
      subject: r.subject,
      snippet: r.snippet,
      html,
      date: r.date,
      isRead: r.is_read === 1,
      isStarred: r.is_starred === 1,
      folder: r.folder,
      isMine,
      deliveryStatus: r.delivery_status,
      labels: labelRows.filter((l) => l.message_id === r.id).map((l) => l.id),
      attachments: own.filter((a) => !inline.has(a.id)).map(toAttachmentInfo),
    };
  });
  const labels = new Map<number, LabelInfo>();
  for (const l of labelRows) labels.set(l.id, { id: l.id, name: l.name, color: l.color });
  return {
    threadId,
    subject: rows[0].subject,
    labels: [...labels.values()],
    inInbox: rows.some((r) => r.folder === 'inbox'),
    folders: [...new Set(rows.map((r) => r.folder))],
    messages,
  };
}
