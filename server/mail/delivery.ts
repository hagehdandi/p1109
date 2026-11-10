import dns from 'node:dns/promises';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { simpleParser, type AddressObject } from 'mailparser';
import { config } from '../config';
import { db, type UserRow } from '../db';
import { notify } from '../events';
import { cleanHtml, escapeHtml, htmlToText, snippetOf, textToHtml } from './format';
import {
  type Addr,
  type FileInput,
  addAttachment,
  insertMessage,
  loadAttachmentFiles,
  newMessageId,
  refreshHasAttachments,
  resolveThreadId,
  syncAttachments,
  threadingFor,
} from './mailbox';

export const isLocalAddress = (address: string) => address.toLowerCase().endsWith(`@${config.domain}`);

export const findUserByEmail = (address: string) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(address.trim().toLowerCase()) as UserRow | undefined;

type Outgoing = {
  messageId: string;
  inReplyTo: string | null;
  refs: string[];
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  html: string;
  text: string;
  date: number;
  attachments: FileInput[];
};

/** Simpan salinan pesan ke kotak masuk pengguna lokal. */
export function deliverLocal(target: UserRow, mail: Outgoing, opts: { spam?: boolean } = {}): number {
  // Message-ID pesan itu sendiri ikut dicari agar email ke diri sendiri masuk ke percakapan yang sama.
  const threadId = resolveThreadId(target.id, [mail.messageId, mail.inReplyTo, ...mail.refs]);
  const id = db.transaction(() => {
    const rowId = insertMessage({
      userId: target.id,
      threadId,
      folder: opts.spam ? 'spam' : 'inbox',
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      refs: mail.refs,
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      date: mail.date,
    });
    for (const file of mail.attachments) addAttachment(target.id, rowId, file);
    if (mail.attachments.length) refreshHasAttachments(rowId);
    return rowId;
  })();
  notify(target.id);
  return id;
}

export type ComposeInput = {
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  replyToId?: number | null;
  attachmentIds: number[];
  draftId?: number | null;
};

function dedupe(list: Addr[]): Addr[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sendMessage(user: UserRow, input: ComposeInput): { id: number; threadId: string } {
  const html = cleanHtml(input.html);
  const text = htmlToText(html);
  const subject = input.subject.trim();
  const from: Addr = { name: user.name, address: user.email };
  const messageId = newMessageId();
  const date = Date.now();
  const recipients = dedupe([...input.to, ...input.cc, ...input.bcc]);
  const external = recipients.filter((a) => !isLocalAddress(a.address));
  const draft = input.draftId
    ? (db.prepare(`SELECT id, reply_to_id FROM messages WHERE id = ? AND user_id = ? AND folder = 'drafts'`).get(input.draftId, user.id) as
        | { id: number; reply_to_id: number | null }
        | undefined)
    : undefined;
  const t = threadingFor(user.id, input.replyToId ?? draft?.reply_to_id ?? null);
  const status = external.length ? 'sending' : 'delivered';

  const sentId = db.transaction(() => {
    let id: number;
    if (draft) {
      db.prepare(
        `UPDATE messages SET thread_id = ?, folder = 'sent', message_id = ?, in_reply_to = ?, refs = ?, from_name = ?, from_addr = ?,
           to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, snippet = ?, body_html = ?, body_text = ?, is_read = 1, date = ?,
           delivery_status = ?, reply_to_id = ? WHERE id = ?`,
      ).run(
        t.threadId,
        messageId,
        t.inReplyTo,
        t.refs.join(' '),
        from.name,
        from.address,
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        JSON.stringify(input.bcc),
        subject,
        snippetOf(text),
        html,
        text,
        date,
        status,
        t.replyToId,
        draft.id,
      );
      id = draft.id;
    } else {
      id = insertMessage({
        userId: user.id,
        threadId: t.threadId,
        folder: 'sent',
        messageId,
        inReplyTo: t.inReplyTo,
        refs: t.refs,
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject,
        html,
        text,
        isRead: true,
        date,
        deliveryStatus: status,
        replyToId: t.replyToId,
      });
    }
    syncAttachments(user.id, id, input.attachmentIds);
    return id;
  })();

  const outgoing: Outgoing = {
    messageId,
    inReplyTo: t.inReplyTo,
    refs: t.refs,
    from,
    to: input.to,
    cc: input.cc,
    subject,
    html,
    text,
    date,
    attachments: loadAttachmentFiles(sentId),
  };
  for (const rcpt of recipients.filter((a) => isLocalAddress(a.address))) {
    const target = findUserByEmail(rcpt.address);
    if (target) deliverLocal(target, outgoing);
    else
      bounce(
        user,
        t.threadId,
        [rcpt.address],
        'Alamat tidak ditemukan. Akun tersebut tidak ada di server ini — periksa kembali ejaan alamat penerima.',
        subject,
      );
  }
  if (external.length) {
    void deliverExternal(
      user,
      sentId,
      t.threadId,
      outgoing,
      external.map((a) => a.address),
    );
  }
  notify(user.id);
  return { id: sentId, threadId: t.threadId };
}

/* ------------------------------------------------------ pengiriman keluar */

function dkimOptions() {
  const { dkimSelector, dkimKeyFile } = config.outbound;
  if (!dkimSelector || !dkimKeyFile) return undefined;
  try {
    return { domainName: config.domain, keySelector: dkimSelector, privateKey: fs.readFileSync(dkimKeyFile, 'utf8') };
  } catch (err) {
    console.error('[dkim] gagal membaca kunci privat:', (err as Error).message);
    return undefined;
  }
}

function mailOptions(mail: Outgoing) {
  return {
    from: mail.from,
    to: mail.to,
    cc: mail.cc.length ? mail.cc : undefined,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    messageId: mail.messageId,
    date: new Date(mail.date),
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.refs.length ? mail.refs : undefined,
    attachments: mail.attachments.map((a) => ({
      filename: a.filename,
      content: a.data,
      contentType: a.contentType,
      cid: a.contentId ?? undefined,
    })),
    headers: { 'X-Mailer': `${config.appName} Webmail` },
  };
}

async function deliverDirect(domain: string, rcpts: string[], options: ReturnType<typeof mailOptions>, from: string) {
  let hosts: string[] = [];
  try {
    hosts = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((mx) => mx.exchange).filter(Boolean);
  } catch {
    hosts = [];
  }
  if (!hosts.length) hosts = [domain];
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      const transport = nodemailer.createTransport({
        host,
        port: 25,
        secure: false,
        name: config.smtp.hostname,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 20_000,
        greetingTimeout: 15_000,
        socketTimeout: 60_000,
        dkim: dkimOptions(),
      });
      await transport.sendMail({ ...options, envelope: { from, to: rcpts } });
      return;
    } catch (err) {
      lastError = err;
      const code = (err as { responseCode?: number }).responseCode;
      if (code && code >= 500) break; // penolakan permanen: tidak perlu mencoba MX cadangan
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Tidak dapat terhubung ke server email ${domain}.`);
}

function setDeliveryStatus(id: number, status: string) {
  db.prepare('UPDATE messages SET delivery_status = ? WHERE id = ?').run(status, id);
}

async function deliverExternal(user: UserRow, sentId: number, threadId: string, mail: Outgoing, rcpts: string[]) {
  try {
    const options = mailOptions(mail);
    const { mode } = config.outbound;
    if (mode === 'relay') {
      const transport = nodemailer.createTransport({
        host: config.outbound.relayHost,
        port: config.outbound.relayPort,
        secure: config.outbound.relaySecure,
        auth: config.outbound.relayUser ? { user: config.outbound.relayUser, pass: config.outbound.relayPass } : undefined,
        dkim: dkimOptions(),
      });
      await transport.sendMail({ ...options, envelope: { from: user.email, to: rcpts } });
    } else if (mode === 'direct') {
      const byDomain = new Map<string, string[]>();
      for (const r of rcpts) {
        const domain = r.split('@')[1] ?? '';
        byDomain.set(domain, [...(byDomain.get(domain) ?? []), r]);
      }
      for (const [domain, list] of byDomain) await deliverDirect(domain, list, options, user.email);
    } else {
      throw new Error(
        'Server ini belum dikonfigurasi untuk mengirim email ke domain luar. Administrator perlu mengatur OUTBOUND_MODE (relay atau direct) di file .env.',
      );
    }
    setDeliveryStatus(sentId, 'delivered');
  } catch (err) {
    setDeliveryStatus(sentId, 'failed');
    bounce(user, threadId, rcpts, (err as Error).message || 'Kesalahan tidak diketahui.', mail.subject);
  }
  notify(user.id);
}

/** Pemberitahuan kegagalan kirim, ditempatkan di percakapan yang sama seperti Gmail. */
export function bounce(user: UserRow, threadId: string, rcpts: string[], reason: string, subject: string): void {
  const list = rcpts.map((r) => `<b>${escapeHtml(r)}</b>`).join(', ');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f1f1f;max-width:600px">
<div style="border-left:4px solid #c5221f;padding:2px 0 2px 16px">
<div style="font-size:20px;line-height:28px;margin-bottom:6px;color:#c5221f">Pesan tidak terkirim</div>
<div style="line-height:22px">Pesan Anda tidak dapat dikirim ke ${list}.</div></div>
<div style="margin-top:20px;padding:12px 16px;background:#f8f9fa;border:1px solid #e0e3e7;border-radius:8px;line-height:20px">
<div style="font-weight:bold;margin-bottom:4px">Alasan</div>${escapeHtml(reason)}</div>
<div style="margin-top:16px;color:#5f6368;font-size:12px">Subjek pesan asli: ${escapeHtml(subject || '(tanpa subjek)')}</div></div>`;
  insertMessage({
    userId: user.id,
    threadId,
    folder: 'inbox',
    messageId: newMessageId(),
    from: { name: 'Mail Delivery Subsystem', address: `mailer-daemon@${config.domain}` },
    to: [{ name: user.name, address: user.email }],
    subject: `Pesan tidak terkirim: ${subject || '(tanpa subjek)'}`,
    html,
    text: htmlToText(html),
    date: Date.now(),
  });
  notify(user.id);
}

/* ------------------------------------------------------------ email masuk */

function addrList(value: AddressObject | AddressObject[] | undefined): Addr[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((o) => o.value)
    .filter((a) => !!a.address)
    .map((a) => ({ name: a.name || '', address: String(a.address).toLowerCase() }));
}

/** Proses email mentah (RFC 5322) yang diterima server SMTP lalu kirim ke penerima lokal. */
export async function receiveInbound(raw: Buffer, rcpts: string[], envelopeFrom?: string): Promise<number> {
  const parsed = await simpleParser(raw);
  const sender = parsed.from?.value?.[0];
  const from: Addr = {
    name: sender?.name || '',
    address: (sender?.address || envelopeFrom || 'unknown@unknown').toLowerCase(),
  };
  const html = parsed.html ? cleanHtml(parsed.html) : textToHtml(parsed.text ?? '');
  const text = parsed.text?.trim() ? parsed.text : htmlToText(html);
  const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? parsed.references.split(/\s+/) : [];
  const spam = String(parsed.headers.get('x-spam-flag') ?? '').trim().toUpperCase() === 'YES';
  const mail: Outgoing = {
    messageId: parsed.messageId || newMessageId(),
    inReplyTo: parsed.inReplyTo || null,
    refs: refs.filter(Boolean).slice(-30),
    from,
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    subject: parsed.subject ?? '',
    html,
    text,
    date: Date.now(),
    attachments: parsed.attachments.map((a) => ({
      filename: a.filename || 'lampiran',
      contentType: a.contentType || 'application/octet-stream',
      data: a.content,
      contentId: a.contentId ? a.contentId.replace(/^<|>$/g, '') : null,
    })),
  };
  let delivered = 0;
  for (const address of new Set(rcpts.map((r) => r.toLowerCase()))) {
    const target = findUserByEmail(address);
    if (!target) continue;
    deliverLocal(target, mail, { spam });
    delivered++;
  }
  return delivered;
}
