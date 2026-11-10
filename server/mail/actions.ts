import { db, type UserRow } from '../db';
import { HttpError } from '../http';
import { snippetOf } from './format';
import {
  type Addr,
  type AttachmentRow,
  FOLDERS,
  type Folder,
  type MessageRow,
  type View,
  gcBlobs,
  insertMessage,
  parseAddrs,
  placeholders,
  scopeFor,
  syncAttachments,
  threadingFor,
  toAttachmentInfo,
} from './mailbox';

const ESC = `ESCAPE '\\'`;
const likeValue = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

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
export const THREAD_ACTIONS: readonly ThreadAction[] = [
  'archive',
  'inbox',
  'trash',
  'delete',
  'spam',
  'read',
  'unread',
  'star',
  'unstar',
  'label_add',
  'label_remove',
];
export type Snapshot = { id: number; folder: Folder; prev_folder: Folder | null; is_read: number; is_starred: number };

export function ownsLabel(userId: number, labelId: number | undefined): labelId is number {
  return !!labelId && !!db.prepare('SELECT 1 FROM labels WHERE id = ? AND user_id = ?').get(labelId, userId);
}

/** Terapkan tindakan pada percakapan; mengembalikan status sebelumnya untuk fitur "Urungkan". */
export function threadAction(
  userId: number,
  threadIds: string[],
  view: View,
  action: ThreadAction,
  opts: { labelId?: number; q?: string } = {},
): Snapshot[] {
  const ids = [...new Set(threadIds)].slice(0, 1000);
  if (!ids.length) return [];
  if ((action === 'label_add' || action === 'label_remove') && !ownsLabel(userId, opts.labelId)) {
    throw new HttpError(404, 'Label tidak ditemukan.');
  }
  const scope = scopeFor(userId, view, opts.q);
  const where = `user_id = ? AND thread_id IN (${placeholders(ids.length)})`;
  const params = [userId, ...ids];
  const snapshot = db
    .prepare(`SELECT id, folder, prev_folder, is_read, is_starred FROM messages WHERE ${where} AND folder != 'drafts'`)
    .all(...params) as Snapshot[];
  const run = (sql: string, ...extra: unknown[]) => db.prepare(sql).run(...extra, ...params);
  const latestIds = () =>
    ids
      .map(
        (threadId) =>
          (
            db
              .prepare(`SELECT id FROM messages WHERE user_id = ? AND thread_id = ? AND (${scope}) ORDER BY date DESC, id DESC LIMIT 1`)
              .get(userId, threadId) as { id: number } | undefined
          )?.id,
      )
      .filter((id): id is number => id !== undefined);
  const updateIds = (sql: string, list: number[]) => {
    if (list.length) db.prepare(`UPDATE messages SET ${sql} WHERE id IN (${placeholders(list.length)})`).run(...list);
  };

  db.transaction(() => {
    switch (action) {
      case 'archive':
        run(`UPDATE messages SET folder = 'archive' WHERE ${where} AND folder = 'inbox'`);
        break;
      case 'inbox':
        run(
          `UPDATE messages SET folder = CASE WHEN folder = 'archive' THEN 'inbox' WHEN prev_folder = 'sent' THEN 'sent' ELSE 'inbox' END,
             prev_folder = NULL WHERE ${where} AND folder IN ('archive', 'trash', 'spam') AND (${scope})`,
        );
        break;
      case 'trash':
        run(`UPDATE messages SET prev_folder = folder, folder = 'trash' WHERE ${where} AND folder NOT IN ('trash', 'drafts') AND (${scope})`);
        break;
      case 'delete':
        run(`DELETE FROM messages WHERE ${where} AND folder IN ('trash', 'spam') AND (${scope})`);
        break;
      case 'spam':
        run(`UPDATE messages SET prev_folder = folder, folder = 'spam' WHERE ${where} AND folder IN ('inbox', 'archive')`);
        break;
      case 'read':
        run(`UPDATE messages SET is_read = 1 WHERE ${where} AND (${scope})`);
        break;
      case 'unread':
        updateIds('is_read = 0', latestIds());
        break;
      case 'star':
        updateIds('is_starred = 1', latestIds());
        break;
      case 'unstar':
        run(`UPDATE messages SET is_starred = 0 WHERE ${where}`);
        break;
      case 'label_add':
        run(
          `INSERT OR IGNORE INTO message_labels (message_id, label_id)
           SELECT id, ? FROM messages WHERE ${where} AND (${scope}) AND folder != 'drafts'`,
          opts.labelId,
        );
        break;
      case 'label_remove':
        run(`DELETE FROM message_labels WHERE label_id = ? AND message_id IN (SELECT id FROM messages WHERE ${where})`, opts.labelId);
        break;
    }
  })();
  if (action === 'delete') gcBlobs();
  return snapshot;
}

export function restoreSnapshot(userId: number, items: Snapshot[]): void {
  const stmt = db.prepare(
    `UPDATE messages SET folder = ?, prev_folder = ?, is_read = ?, is_starred = ? WHERE id = ? AND user_id = ? AND folder != 'drafts'`,
  );
  db.transaction(() => {
    for (const s of items.slice(0, 5000)) {
      if (!FOLDERS.includes(s.folder) || s.folder === 'drafts') continue;
      const prev = s.prev_folder && FOLDERS.includes(s.prev_folder) ? s.prev_folder : null;
      stmt.run(s.folder, prev, s.is_read ? 1 : 0, s.is_starred ? 1 : 0, Number(s.id), userId);
    }
  })();
}

export type MessageAction = 'star' | 'unstar' | 'read' | 'unread' | 'trash' | 'delete';
export const MESSAGE_ACTIONS: readonly MessageAction[] = ['star', 'unstar', 'read', 'unread', 'trash', 'delete'];

export function messageAction(userId: number, id: number, action: MessageAction): boolean {
  const row = db.prepare('SELECT id, folder FROM messages WHERE id = ? AND user_id = ?').get(id, userId) as
    | { id: number; folder: Folder }
    | undefined;
  if (!row) return false;
  const set = (sql: string) => db.prepare(`UPDATE messages SET ${sql} WHERE id = ?`).run(id);
  switch (action) {
    case 'star':
      set('is_starred = 1');
      break;
    case 'unstar':
      set('is_starred = 0');
      break;
    case 'read':
      set('is_read = 1');
      break;
    case 'unread':
      set('is_read = 0');
      break;
    case 'trash':
      if (row.folder !== 'trash' && row.folder !== 'drafts') set(`prev_folder = folder, folder = 'trash'`);
      break;
    case 'delete':
      if (row.folder === 'trash' || row.folder === 'spam') {
        db.prepare('DELETE FROM messages WHERE id = ?').run(id);
        gcBlobs();
      }
      break;
  }
  return true;
}

export function emptyFolder(userId: number, folder: 'trash' | 'spam'): number {
  const info = db.prepare('DELETE FROM messages WHERE user_id = ? AND folder = ?').run(userId, folder);
  gcBlobs();
  return info.changes;
}

/* -------------------------------------------------------------------- draf */

export type DraftInput = {
  id?: number;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  text: string;
  replyToId?: number | null;
  attachmentIds: number[];
};

export function saveDraft(user: UserRow, input: DraftInput): number {
  return db.transaction(() => {
    const existing = input.id
      ? (db.prepare(`SELECT id FROM messages WHERE id = ? AND user_id = ? AND folder = 'drafts'`).get(input.id, user.id) as
          | { id: number }
          | undefined)
      : undefined;
    let id: number;
    if (existing) {
      db.prepare(
        `UPDATE messages SET to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, snippet = ?, body_html = ?, body_text = ?,
           from_name = ?, from_addr = ?, date = ? WHERE id = ?`,
      ).run(
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        JSON.stringify(input.bcc),
        input.subject,
        snippetOf(input.text),
        input.html,
        input.text,
        user.name,
        user.email,
        Date.now(),
        existing.id,
      );
      id = existing.id;
    } else {
      const t = threadingFor(user.id, input.replyToId);
      id = insertMessage({
        userId: user.id,
        threadId: t.threadId,
        folder: 'drafts',
        inReplyTo: t.inReplyTo,
        refs: t.refs,
        from: { name: user.name, address: user.email },
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        html: input.html,
        text: input.text,
        isRead: true,
        replyToId: t.replyToId,
      });
    }
    syncAttachments(user.id, id, input.attachmentIds);
    return id;
  })();
}

export function getDraft(userId: number, id: number) {
  const r = db.prepare(`SELECT * FROM messages WHERE id = ? AND user_id = ? AND folder = 'drafts'`).get(id, userId) as
    | MessageRow
    | undefined;
  if (!r) return null;
  const atts = db.prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY id').all(id) as AttachmentRow[];
  return {
    id: r.id,
    to: parseAddrs(r.to_json),
    cc: parseAddrs(r.cc_json),
    bcc: parseAddrs(r.bcc_json),
    subject: r.subject,
    html: r.body_html,
    replyToId: r.reply_to_id,
    attachments: atts.map(toAttachmentInfo),
  };
}

export function deleteDraft(userId: number, id: number): boolean {
  const info = db.prepare(`DELETE FROM messages WHERE id = ? AND user_id = ? AND folder = 'drafts'`).run(id, userId);
  gcBlobs();
  return info.changes > 0;
}

/* -------------------------------------------------------------- lain-lain */

export function getCounts(userId: number) {
  const one = (sql: string) => (db.prepare(sql).get(userId) as { n: number }).n;
  const labelRows = db
    .prepare(
      `SELECT ml.label_id AS id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN message_labels ml ON ml.message_id = m.id
       WHERE m.user_id = ? AND m.is_read = 0 AND m.folder NOT IN ('trash', 'spam', 'drafts') GROUP BY ml.label_id`,
    )
    .all(userId) as { id: number; n: number }[];
  return {
    inbox: one(`SELECT COUNT(DISTINCT thread_id) AS n FROM messages WHERE user_id = ? AND folder = 'inbox' AND is_read = 0`),
    spam: one(`SELECT COUNT(DISTINCT thread_id) AS n FROM messages WHERE user_id = ? AND folder = 'spam' AND is_read = 0`),
    drafts: one(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND folder = 'drafts'`),
    labels: Object.fromEntries(labelRows.map((r) => [r.id, r.n])) as Record<number, number>,
  };
}

export function getContacts(user: UserRow, q: string): Addr[] {
  const query = q.trim().toLowerCase();
  const like = likeValue(query);
  const me = user.email.toLowerCase();
  const out = new Map<string, Addr>();
  const add = (a: Addr) => {
    const key = a.address.toLowerCase();
    if (!key || key === me || key.startsWith('mailer-daemon@') || out.has(key)) return;
    out.set(key, { name: a.name, address: key });
  };
  (
    db
      .prepare(`SELECT name, email AS address FROM users WHERE email LIKE ? ${ESC} OR name LIKE ? ${ESC} ORDER BY name LIMIT 10`)
      .all(like, like) as Addr[]
  ).forEach(add);
  (
    db
      .prepare(
        `SELECT from_name AS name, from_addr AS address FROM messages WHERE user_id = ? AND folder NOT IN ('spam', 'drafts')
         AND (from_addr LIKE ? ${ESC} OR from_name LIKE ? ${ESC}) GROUP BY from_addr ORDER BY MAX(date) DESC LIMIT 10`,
      )
      .all(user.id, like, like) as Addr[]
  ).forEach(add);
  const sent = db
    .prepare(
      `SELECT to_json, cc_json FROM messages WHERE user_id = ? AND folder = 'sent' AND (to_json LIKE ? ${ESC} OR cc_json LIKE ? ${ESC})
       ORDER BY date DESC LIMIT 50`,
    )
    .all(user.id, like, like) as { to_json: string; cc_json: string }[];
  for (const row of sent) {
    for (const a of [...parseAddrs(row.to_json), ...parseAddrs(row.cc_json)]) {
      if (`${a.name} ${a.address}`.toLowerCase().includes(query)) add(a);
    }
  }
  return [...out.values()].slice(0, 8);
}

export function storageUsed(userId: number): number {
  const m = db
    .prepare('SELECT COALESCE(SUM(LENGTH(body_html) + LENGTH(body_text)), 0) AS n FROM messages WHERE user_id = ?')
    .get(userId) as { n: number };
  const a = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE user_id = ?').get(userId) as { n: number };
  return m.n + a.n;
}
