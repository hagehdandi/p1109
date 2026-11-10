import express, { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  clearFailures,
  createSession,
  destroySession,
  hashPassword,
  isThrottled,
  recordFailure,
  requireUser,
  userOf,
  verifyPassword,
} from './auth';
import { config } from './config';
import { db, type UserRow } from './db';
import { subscribe } from './events';
import { fail } from './http';
import * as actions from './mail/actions';
import { findUserByEmail, sendMessage } from './mail/delivery';
import { cleanHtml, htmlToText, isEmail } from './mail/format';
import * as mailbox from './mail/mailbox';

export const api = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxMessageBytes, files: 1 } });
const AVATAR_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83', '#c5221f', '#b06000', '#3367d6', '#8430ce'];
const RESERVED = new Set(['admin', 'administrator', 'root', 'postmaster', 'abuse', 'mailer-daemon', 'noreply', 'no-reply', 'hostmaster', 'webmaster', 'security']);

const str = (value: unknown, max = 10_000) => (typeof value === 'string' ? value : '').slice(0, max);
const int = (value: unknown) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, color: u.color, signature: u.signature });

function parseView(value: unknown): mailbox.View {
  return (mailbox.VIEWS as readonly string[]).includes(String(value)) ? (value as mailbox.View) : 'inbox';
}

function parseRecipients(value: unknown): mailbox.Addr[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .map((item) =>
      typeof item === 'string'
        ? { name: '', address: item }
        : { name: str(item?.name, 120), address: str(item?.address, 320) },
    )
    .map((a) => ({ name: a.name.trim(), address: a.address.trim().toLowerCase() }))
    .filter((a) => a.address);
}

function parseCompose(body: Record<string, unknown>) {
  return {
    to: parseRecipients(body.to),
    cc: parseRecipients(body.cc),
    bcc: parseRecipients(body.bcc),
    subject: str(body.subject, 500),
    html: str(body.html, 20_000_000),
    replyToId: int(body.replyToId) || null,
    attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(Number).filter(Number.isInteger) : [],
  };
}

// Proteksi CSRF: semua permintaan yang mengubah data wajib membawa header khusus.
api.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-requested-with') !== 'dmails') return fail(res, 403, 'Permintaan ditolak.');
  next();
});
api.use(express.json({ limit: '30mb' }));

/* ------------------------------------------------------------------ publik */

api.get('/config', (_req, res) => {
  res.json({
    appName: config.appName,
    domain: config.domain,
    allowSignup: config.allowSignup,
    demo: config.seedDemo && !!findUserByEmail(`raka@${config.domain}`),
    smtp: { enabled: config.smtp.enabled, hostname: config.smtp.hostname, port: config.smtp.port },
    outboundMode: config.outbound.mode,
  });
});

api.post('/auth/register', (req, res) => {
  if (!config.allowSignup) return fail(res, 403, 'Pendaftaran akun baru dinonaktifkan oleh administrator.');
  const body = req.body ?? {};
  const name = str(body.name, 80).trim();
  const username = str(body.username, 64).trim().toLowerCase();
  const password = str(body.password, 200);
  if (name.length < 2) return fail(res, 400, 'Masukkan nama Anda (minimal 2 karakter).');
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(username)) {
    return fail(res, 400, 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.');
  }
  if (RESERVED.has(username)) return fail(res, 400, 'Nama pengguna ini tidak tersedia.');
  if (password.length < 8) return fail(res, 400, 'Gunakan sandi minimal 8 karakter.');
  const email = `${username}@${config.domain}`;
  if (findUserByEmail(email)) return fail(res, 409, 'Nama pengguna sudah dipakai. Coba yang lain.');
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash, color, signature, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email, name, hashPassword(password), color, '', Date.now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
  createSession(res, user.id);
  res.status(201).json(publicUser(user));
});

api.post('/auth/login', (req, res) => {
  const key = req.ip ?? 'unknown';
  if (isThrottled(key)) return fail(res, 429, 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.');
  let email = str(req.body?.email, 320).trim().toLowerCase();
  if (email && !email.includes('@')) email += `@${config.domain}`;
  const user = email ? findUserByEmail(email) : undefined;
  if (!user || !verifyPassword(str(req.body?.password, 200), user.password_hash)) {
    recordFailure(key);
    return fail(res, 401, 'Email atau sandi salah. Coba lagi.');
  }
  clearFailures(key);
  createSession(res, user.id);
  res.json(publicUser(user));
});

api.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/* ----------------------------------------------------------- perlu masuk */

api.use(requireUser);

api.get('/me', (_req, res) => {
  const u = userOf(res);
  res.json({ ...publicUser(u), storageUsed: actions.storageUsed(u.id), storageQuota: config.quotaBytes });
});

api.patch('/me', (req, res) => {
  const u = userOf(res);
  const body = req.body ?? {};
  const name = body.name === undefined ? u.name : str(body.name, 80).trim();
  const signature = body.signature === undefined ? u.signature : str(body.signature, 2000);
  if (!name) return fail(res, 400, 'Nama tidak boleh kosong.');
  db.prepare('UPDATE users SET name = ?, signature = ? WHERE id = ?').run(name, signature, u.id);
  res.json(publicUser({ ...u, name, signature }));
});

api.post('/me/password', (req, res) => {
  const u = userOf(res);
  if (!verifyPassword(str(req.body?.current, 200), u.password_hash)) return fail(res, 400, 'Sandi saat ini salah.');
  const next = str(req.body?.next, 200);
  if (next.length < 8) return fail(res, 400, 'Sandi baru minimal 8 karakter.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
  res.json({ ok: true });
});

api.get('/counts', (_req, res) => {
  res.json(actions.getCounts(userOf(res).id));
});

api.get('/threads', (req, res) => {
  const page = Math.max(1, int(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, int(req.query.pageSize) || 50));
  res.json(
    mailbox.listThreads(userOf(res), {
      view: parseView(req.query.view),
      labelId: int(req.query.label) || undefined,
      q: str(req.query.q, 500),
      page,
      pageSize,
    }),
  );
});

api.get('/threads/:threadId', (req, res) => {
  const thread = mailbox.getThread(userOf(res), req.params.threadId, parseView(req.query.view), str(req.query.q, 500));
  if (!thread) return fail(res, 404, 'Percakapan tidak ditemukan.');
  res.json(thread);
});

api.post('/threads/action', (req, res) => {
  const body = req.body ?? {};
  const action = String(body.action) as actions.ThreadAction;
  if (!actions.THREAD_ACTIONS.includes(action)) return fail(res, 400, 'Tindakan tidak dikenal.');
  const threadIds = Array.isArray(body.threadIds) ? body.threadIds.filter((t: unknown): t is string => typeof t === 'string') : [];
  const undo = actions.threadAction(userOf(res).id, threadIds, parseView(body.view), action, {
    labelId: int(body.labelId) || undefined,
    q: str(body.q, 500),
  });
  res.json({ ok: true, undo });
});

api.post('/threads/empty', (req, res) => {
  const folder = req.body?.folder === 'spam' ? 'spam' : 'trash';
  res.json({ ok: true, deleted: actions.emptyFolder(userOf(res).id, folder) });
});

api.post('/messages/restore', (req, res) => {
  const items = Array.isArray(req.body?.items) ? (req.body.items as actions.Snapshot[]) : [];
  actions.restoreSnapshot(userOf(res).id, items);
  res.json({ ok: true });
});

api.post('/messages/:id/action', (req, res) => {
  const action = String(req.body?.action) as actions.MessageAction;
  if (!actions.MESSAGE_ACTIONS.includes(action)) return fail(res, 400, 'Tindakan tidak dikenal.');
  if (!actions.messageAction(userOf(res).id, int(req.params.id), action)) return fail(res, 404, 'Pesan tidak ditemukan.');
  res.json({ ok: true });
});

/* ------------------------------------------------------------ tulis/kirim */

api.get('/drafts/:id', (req, res) => {
  const draft = actions.getDraft(userOf(res).id, int(req.params.id));
  if (!draft) return fail(res, 404, 'Draf tidak ditemukan.');
  res.json(draft);
});

api.post('/drafts', (req, res) => {
  const input = parseCompose(req.body ?? {});
  const html = cleanHtml(input.html);
  const id = actions.saveDraft(userOf(res), { ...input, id: int(req.body?.id) || undefined, html, text: htmlToText(html) });
  res.json({ id });
});

api.delete('/drafts/:id', (req, res) => {
  if (!actions.deleteDraft(userOf(res).id, int(req.params.id))) return fail(res, 404, 'Draf tidak ditemukan.');
  res.json({ ok: true });
});

api.post('/send', (req, res) => {
  const input = parseCompose(req.body ?? {});
  const all = [...input.to, ...input.cc, ...input.bcc];
  if (!all.length) return fail(res, 400, 'Tentukan setidaknya satu penerima.');
  const invalid = all.find((a) => !isEmail(a.address));
  if (invalid) return fail(res, 400, `Alamat "${invalid.address}" tidak valid. Periksa kembali penerima.`);
  const result = sendMessage(userOf(res), { ...input, draftId: int(req.body?.draftId) || null });
  res.status(201).json(result);
});

/* --------------------------------------------------------------- lampiran */

// Busboy membaca nama file sebagai latin1; kembalikan ke UTF-8 bila valid.
function fixFilename(name: string): string {
  if (/[\u0080-\u00ff]/.test(name)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) return decoded;
  }
  return name;
}

api.post('/attachments', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return fail(res, 400, 'Tidak ada file yang diunggah.');
  const info = mailbox.addAttachment(userOf(res).id, null, {
    filename: fixFilename(file.originalname).slice(0, 200) || 'lampiran',
    contentType: file.mimetype || 'application/octet-stream',
    data: file.buffer,
  });
  res.status(201).json(info);
});

api.post('/attachments/forward', (req, res) => {
  res.json(mailbox.copyAttachments(userOf(res).id, int(req.body?.messageId)));
});

api.get('/attachments/:id', (req, res) => {
  const row = db
    .prepare('SELECT a.filename, a.content_type, b.data FROM attachments a JOIN blobs b ON b.sha256 = a.sha256 WHERE a.id = ? AND a.user_id = ?')
    .get(int(req.params.id), userOf(res).id) as { filename: string; content_type: string; data: Buffer } | undefined;
  if (!row) return fail(res, 404, 'Lampiran tidak ditemukan.');
  const viewable = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|application\/pdf|text\/plain)$/i.test(row.content_type);
  const download = req.query.download === '1' || !viewable;
  const type = /html|svg|xml|javascript/i.test(row.content_type) ? 'application/octet-stream' : row.content_type;
  const ascii = row.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.setHeader('Content-Type', type);
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  );
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(row.data);
});

api.delete('/attachments/:id', (req, res) => {
  const u = userOf(res);
  const info = db
    .prepare(
      `DELETE FROM attachments WHERE id = ? AND user_id = ? AND (message_id IS NULL OR message_id IN (SELECT id FROM messages WHERE user_id = ? AND folder = 'drafts'))`,
    )
    .run(int(req.params.id), u.id, u.id);
  mailbox.gcBlobs();
  res.json({ ok: info.changes > 0 });
});

/* ------------------------------------------------------------------ label */

const LABEL_SELECT = 'SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name COLLATE NOCASE';
const labelColor = (value: unknown) => (/^#[0-9a-f]{6}$/i.test(str(value)) ? str(value) : '#5f6368');

api.get('/labels', (_req, res) => {
  res.json(db.prepare(LABEL_SELECT).all(userOf(res).id));
});

api.post('/labels', (req, res) => {
  const name = str(req.body?.name, 60).trim();
  if (!name) return fail(res, 400, 'Nama label tidak boleh kosong.');
  const color = labelColor(req.body?.color);
  try {
    const info = db.prepare('INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)').run(userOf(res).id, name, color);
    res.status(201).json({ id: Number(info.lastInsertRowid), name, color });
  } catch {
    fail(res, 409, 'Label dengan nama tersebut sudah ada.');
  }
});

api.patch('/labels/:id', (req, res) => {
  const name = str(req.body?.name, 60).trim();
  if (!name) return fail(res, 400, 'Nama label tidak boleh kosong.');
  try {
    const info = db
      .prepare('UPDATE labels SET name = ?, color = ? WHERE id = ? AND user_id = ?')
      .run(name, labelColor(req.body?.color), int(req.params.id), userOf(res).id);
    if (!info.changes) return fail(res, 404, 'Label tidak ditemukan.');
    res.json({ ok: true });
  } catch {
    fail(res, 409, 'Label dengan nama tersebut sudah ada.');
  }
});

api.delete('/labels/:id', (req, res) => {
  db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?').run(int(req.params.id), userOf(res).id);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- lainnya */

api.get('/contacts', (req, res) => {
  res.json(actions.getContacts(userOf(res), str(req.query.q, 100)));
});

api.get('/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const unsubscribe = subscribe(userOf(res).id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

api.use((_req, res) => fail(res, 404, 'Endpoint tidak ditemukan.'));
