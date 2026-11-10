import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  EllipsisVertical,
  FileText,
  Forward,
  Mail,
  OctagonAlert,
  Printer,
  Reply,
  ReplyAll,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AttachmentInfo, type Label, type Me, type MessageDetail, type ThreadDetail, api, invalidateMail } from './api';
import { Composer, type ComposeInit } from './Composer';
import { fetchThreads, threadsKey } from './MailList';
import { type MailRoute, mailPath, navigate } from './router';
import { Avatar, IconButton, MenuItem, Popover, useThreadActions, useToast } from './ui';
import { displayName, escapeHtml, formatFullDate, formatListDate, formatMessageDate, formatSize, isTypingTarget, signatureHtml, tint } from './utils';

function MessageBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const srcDoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff}
body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1f1f;overflow-wrap:anywhere}
p{margin:0 0 10px}img{max-width:100%;height:auto}a{color:#0b57d0}
blockquote{margin:0 0 0 .8ex;border-left:1px solid #c4c7c5;padding-left:1ex;color:#5f6368}
pre{white-space:pre-wrap}table{max-width:100%}.dm-signature{color:#5f6368}
</style></head><body>${html}</body></html>`,
    [html],
  );

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const timers: number[] = [];
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.body) setHeight(Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) + 4);
    };
    const onLoad = () => {
      measure();
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
      try {
        observer = new ResizeObserver(measure);
        observer.observe(doc.body);
      } catch {
        // abaikan; pengukuran berkala di bawah sudah cukup
      }
      timers.push(window.setTimeout(measure, 300), window.setTimeout(measure, 1200));
    };
    frame.addEventListener('load', onLoad);
    window.addEventListener('resize', measure);
    return () => {
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      className="msg-frame"
      title="Isi pesan"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}

function Attachments({ items }: { items: AttachmentInfo[] }) {
  if (!items.length) return null;
  return (
    <div className="msg-attachments">
      <div className="msg-attachments-title">{items.length} lampiran</div>
      <div className="att-grid">
        {items.map((a) => {
          const isImage = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(a.contentType);
          const ext = (a.filename.split('.').pop() ?? '').slice(0, 4).toUpperCase();
          return (
            <a key={a.id} className="att-card" href={`/api/attachments/${a.id}?download=1`} download={a.filename} title={`Unduh ${a.filename}`}>
              <div className="att-preview">
                {isImage ? <img src={`/api/attachments/${a.id}`} alt="" /> : <FileText size={36} strokeWidth={1.4} />}
              </div>
              <div className="att-meta">
                <span className="att-ext">{ext || 'FILE'}</span>
                <span className="att-name">{a.filename}</span>
                <span className="att-size">{formatSize(a.size)}</span>
              </div>
              <span className="att-download">
                <Download size={16} />
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

type ReplyMode = 'reply' | 'replyAll' | 'forward';

function buildReply(mode: ReplyMode, msg: MessageDetail, user: Me): ComposeInit {
  const me = user.email.toLowerCase();
  const sig = signatureHtml(user.signature);
  const head = `<div><br></div>${sig ? `<div><br></div>${sig}` : ''}<div><br></div>`;
  const sender = `${escapeHtml(msg.from.name || msg.from.address)} &lt;${escapeHtml(msg.from.address)}&gt;`;
  const subject = msg.subject || '';
  if (mode === 'forward') {
    const toList = msg.to.map((a) => escapeHtml(a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
    return {
      subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
      html: `${head}<div>---------- Pesan yang diteruskan ---------<br>Dari: ${sender}<br>Tanggal: ${escapeHtml(formatFullDate(msg.date))}<br>Subjek: ${escapeHtml(subject)}<br>Kepada: ${toList}<br><br></div>${msg.html}`,
      replyToId: msg.id,
      title: 'Teruskan',
    };
  }
  const fromMe = msg.from.address.toLowerCase() === me;
  const to = fromMe ? msg.to : [msg.from];
  const cc =
    mode === 'replyAll'
      ? [...(fromMe ? [] : msg.to), ...msg.cc].filter(
          (a) => a.address.toLowerCase() !== me && !to.some((t) => t.address.toLowerCase() === a.address.toLowerCase()),
        )
      : [];
  return {
    to,
    cc,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    html: `${head}<div>Pada ${escapeHtml(formatFullDate(msg.date))} ${sender} menulis:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${msg.html}</blockquote>`,
    replyToId: msg.id,
    title: 'Balas',
  };
}

function recipientSummary(msg: MessageDetail, me: string) {
  const names = [...msg.to, ...msg.cc, ...msg.bcc].map((a) => (a.address.toLowerCase() === me ? 'saya' : a.name || a.address));
  return names.length ? names.join(', ') : '(tanpa penerima)';
}

export function ThreadView({ route, labels, user }: { route: MailRoute; labels: Label[]; user: Me }) {
  const threadId = route.threadId!;
  const qc = useQueryClient();
  const toast = useToast();
  const act = useThreadActions();
  const listRoute = { ...route, threadId: undefined };
  const backPath = mailPath(listRoute);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['thread', threadId, route.view, route.q ?? ''],
    queryFn: () =>
      api.get<ThreadDetail>(`/api/threads/${encodeURIComponent(threadId)}?view=${route.view}&q=${encodeURIComponent(route.q ?? '')}`),
  });
  const list = useQuery({ queryKey: threadsKey(listRoute), queryFn: () => fetchThreads(listRoute) });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [reply, setReply] = useState<{ key: number; init: ComposeInit } | null>(null);
  const [menu, setMenu] = useState<{ kind: 'labels' | 'msg' | 'details'; anchor: HTMLElement; msg?: MessageDetail } | null>(null);
  const me = user.email.toLowerCase();
  const isTrashLike = route.view === 'trash' || route.view === 'spam';
  const opts = { view: route.view, q: route.q };

  // Buka pesan yang belum dibaca serta pesan terakhir; tandai percakapan sudah dibaca.
  useEffect(() => {
    if (!data) return;
    setExpanded((prev) => {
      if (prev.size) return prev;
      const last = data.messages[data.messages.length - 1];
      return new Set(data.messages.filter((m) => !m.isRead || m === last).map((m) => m.id));
    });
    if (data.messages.some((m) => !m.isRead)) {
      void api.post('/api/threads/action', { threadIds: [threadId], action: 'read', ...opts }).then(() => invalidateMail(qc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.threadId, data?.messages.length]);

  useEffect(() => {
    setExpanded(new Set());
    setReply(null);
  }, [threadId]);

  const items = list.data?.items ?? [];
  const index = items.findIndex((i) => i.threadId === threadId);
  const total = list.data?.total ?? 0;
  const position = index >= 0 ? (route.page - 1) * 50 + index + 1 : 0;
  const goTo = (offset: number) => {
    const target = items[index + offset];
    if (target) navigate(mailPath(listRoute, target.threadId));
  };

  const doAndBack = async (action: Parameters<typeof act>[1], message: string, undo = true) => {
    const ok = await act([threadId], action, { ...opts, message, undo });
    if (ok) navigate(backPath);
  };

  const startReply = async (mode: ReplyMode, msg?: MessageDetail) => {
    const target = msg ?? data?.messages[data.messages.length - 1];
    if (!target) return;
    const init = buildReply(mode, target, user);
    if (mode === 'forward' && target.attachments.length) {
      try {
        init.attachments = await api.post<AttachmentInfo[]>('/api/attachments/forward', { messageId: target.id });
      } catch {
        toast.show('Lampiran asli tidak dapat disertakan.');
      }
    }
    setReply({ key: Date.now(), init });
    window.setTimeout(() => document.querySelector('.composer.inline')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || reply) return;
      if (e.key === 'u' || e.key === 'Escape') navigate(backPath);
      else if (e.key === 'r') void startReply('reply');
      else if (e.key === 'a') void startReply('replyAll');
      else if (e.key === 'f') void startReply('forward');
      else if (e.key === 'e' && data?.inInbox) void doAndBack('archive', 'Percakapan diarsipkan.');
      else if (e.key === '#') void doAndBack(isTrashLike ? 'delete' : 'trash', isTrashLike ? 'Percakapan dihapus selamanya.' : 'Percakapan dipindahkan ke Sampah.', !isTrashLike);
      else if (e.key === 'k') goTo(-1);
      else if (e.key === 'j') goTo(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const messageAction = async (msg: MessageDetail, action: string, message?: string) => {
    try {
      await api.post(`/api/messages/${msg.id}/action`, { action });
      invalidateMail(qc);
      if (message) toast.show(message);
    } catch (err) {
      toast.show((err as Error).message);
    }
  };

  if (isPending) {
    return (
      <div className="thread-view">
        <div className="toolbar">
          <IconButton label="Kembali" onClick={() => navigate(backPath)}>
            <ArrowLeft size={20} />
          </IconButton>
        </div>
        <div className="progress on" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="thread-view">
        <div className="toolbar">
          <IconButton label="Kembali" onClick={() => navigate(backPath)}>
            <ArrowLeft size={20} />
          </IconButton>
        </div>
        <div className="empty">
          <AlertCircle size={48} strokeWidth={1.3} />
          <p>{(error as Error | null)?.message ?? 'Percakapan tidak ditemukan.'}</p>
        </div>
      </div>
    );
  }

  const last = data.messages[data.messages.length - 1];
  const canReplyAll = last && [...last.to, ...last.cc].filter((a) => a.address.toLowerCase() !== me).length > 1;
  const threadLabelIds = new Set(data.labels.map((l) => l.id));

  return (
    <div className="thread-view">
      <div className="toolbar">
        <div className="toolbar-left">
          <IconButton label="Kembali ke daftar" onClick={() => navigate(backPath)}>
            <ArrowLeft size={20} />
          </IconButton>
          <span className="toolbar-gap" />
          {isTrashLike ? (
            <>
              <button type="button" className="btn text" onClick={() => void doAndBack('delete', 'Percakapan dihapus selamanya.', false)}>
                Hapus selamanya
              </button>
              <button
                type="button"
                className="btn text"
                onClick={() => void doAndBack('inbox', route.view === 'spam' ? 'Percakapan ditandai bukan spam.' : 'Percakapan dipulihkan.')}
              >
                {route.view === 'spam' ? 'Bukan spam' : 'Pulihkan'}
              </button>
            </>
          ) : (
            <>
              {data.inInbox ? (
                <IconButton label="Arsipkan" onClick={() => void doAndBack('archive', 'Percakapan diarsipkan.')}>
                  <Archive size={18} />
                </IconButton>
              ) : (
                <IconButton label="Pindahkan ke Kotak Masuk" onClick={() => void doAndBack('inbox', 'Percakapan dipindahkan ke Kotak Masuk.')}>
                  <ArchiveRestore size={18} />
                </IconButton>
              )}
              <IconButton label="Laporkan spam" onClick={() => void doAndBack('spam', 'Percakapan ditandai sebagai spam.')}>
                <OctagonAlert size={18} />
              </IconButton>
              <IconButton label="Hapus" onClick={() => void doAndBack('trash', 'Percakapan dipindahkan ke Sampah.')}>
                <Trash2 size={18} />
              </IconButton>
              <span className="toolbar-sep" />
              <IconButton label="Tandai belum dibaca" onClick={() => void doAndBack('unread', 'Percakapan ditandai belum dibaca.', false)}>
                <Mail size={18} />
              </IconButton>
              <IconButton label="Label" onClick={(e) => setMenu({ kind: 'labels', anchor: e.currentTarget })}>
                <Tag size={18} />
              </IconButton>
            </>
          )}
        </div>
        <div className="toolbar-right">
          {position > 0 && (
            <span className="pager-text">
              {position} dari {total.toLocaleString('id-ID')}
            </span>
          )}
          <IconButton label="Lebih baru" disabled={index <= 0} onClick={() => goTo(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Lebih lama" disabled={index < 0 || index >= items.length - 1} onClick={() => goTo(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      <div className="thread-scroll">
        <div className="thread-head">
          <h1 className="thread-subject">{data.subject || '(tanpa subjek)'}</h1>
          <div className="thread-chips">
            {data.inInbox && !isTrashLike && (
              <span className="chip neutral removable">
                Kotak Masuk
                <button type="button" aria-label="Arsipkan" title="Arsipkan" onClick={() => void doAndBack('archive', 'Percakapan diarsipkan.')}>
                  <X size={12} />
                </button>
              </span>
            )}
            {data.labels.map((l) => (
              <span key={l.id} className="chip removable" style={{ background: tint(l.color), color: l.color }}>
                {l.name}
                <button
                  type="button"
                  aria-label={`Hapus label ${l.name}`}
                  title="Hapus label"
                  onClick={() => void act([threadId], 'label_remove', { ...opts, labelId: l.id })}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <IconButton label="Cetak" className="hide-mobile" onClick={() => window.print()}>
            <Printer size={18} />
          </IconButton>
        </div>

        <div className="messages">
          {data.messages.map((msg) => {
            const open = expanded.has(msg.id) || msg === last;
            const fromLabel = msg.from.address.toLowerCase() === me ? 'saya' : msg.from.name || msg.from.address;
            if (!open) {
              return (
                <div
                  key={msg.id}
                  className="msg collapsed"
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded((s) => new Set(s).add(msg.id))}
                  onKeyDown={(e) => e.key === 'Enter' && setExpanded((s) => new Set(s).add(msg.id))}
                >
                  <Avatar name={msg.from.name} email={msg.from.address} size={40} />
                  <div className="msg-collapsed-text">
                    <span className={`msg-from-name${msg.isRead ? '' : ' b'}`}>{fromLabel}</span>
                    <span className="msg-collapsed-snippet">{msg.snippet}</span>
                  </div>
                  <span className="msg-date">{formatListDate(msg.date)}</span>
                </div>
              );
            }
            return (
              <article key={msg.id} className="msg expanded">
                <Avatar name={msg.from.name} email={msg.from.address} size={40} />
                <div className="msg-content">
                  <div
                    className="msg-head"
                    onClick={(e) => {
                      if (msg === last || (e.target as HTMLElement).closest('button')) return;
                      setExpanded((s) => {
                        const next = new Set(s);
                        next.delete(msg.id);
                        return next;
                      });
                    }}
                  >
                    <div className="msg-from">
                      <span className="msg-from-name b">{msg.from.name || msg.from.address}</span>
                      {msg.from.name && <span className="msg-from-addr">&lt;{msg.from.address}&gt;</span>}
                    </div>
                    <div className="msg-meta">
                      <span className="msg-date" title={formatFullDate(msg.date)}>
                        {formatMessageDate(msg.date)}
                      </span>
                      <button
                        type="button"
                        className={`star-btn${msg.isStarred ? ' on' : ''}`}
                        aria-label={msg.isStarred ? 'Hapus bintang' : 'Beri bintang'}
                        title={msg.isStarred ? 'Berbintang' : 'Tidak berbintang'}
                        onClick={() => void messageAction(msg, msg.isStarred ? 'unstar' : 'star')}
                      >
                        <Star size={18} />
                      </button>
                      <IconButton label="Balas" small className="hide-mobile" onClick={() => void startReply('reply', msg)}>
                        <Reply size={18} />
                      </IconButton>
                      <IconButton label="Lainnya" small onClick={(e) => setMenu({ kind: 'msg', anchor: e.currentTarget, msg })}>
                        <EllipsisVertical size={18} />
                      </IconButton>
                    </div>
                  </div>
                  <button type="button" className="msg-to" onClick={(e) => setMenu({ kind: 'details', anchor: e.currentTarget, msg })}>
                    kepada {recipientSummary(msg, me)} <ChevronDown size={14} />
                  </button>
                  {msg.isMine && msg.deliveryStatus === 'failed' && (
                    <div className="delivery-note error">
                      <AlertCircle size={16} /> Pesan ini gagal dikirim ke sebagian penerima di luar server.
                    </div>
                  )}
                  {msg.isMine && msg.deliveryStatus === 'sending' && <div className="delivery-note">Sedang dikirim ke penerima di luar server…</div>}
                  <MessageBody html={msg.html} />
                  <Attachments items={msg.attachments} />
                </div>
              </article>
            );
          })}
        </div>

        {reply ? (
          <div className="inline-reply">
            <Avatar name={user.name} email={user.email} color={user.color} size={40} />
            <Composer key={reply.key} init={reply.init} user={user} variant="inline" onClose={() => setReply(null)} />
          </div>
        ) : (
          !isTrashLike && (
            <div className="reply-actions">
              <button type="button" className="btn pill" onClick={() => void startReply('reply')}>
                <Reply size={18} /> Balas
              </button>
              {canReplyAll && (
                <button type="button" className="btn pill" onClick={() => void startReply('replyAll')}>
                  <ReplyAll size={18} /> Balas ke semua
                </button>
              )}
              <button type="button" className="btn pill" onClick={() => void startReply('forward')}>
                <Forward size={18} /> Teruskan
              </button>
            </div>
          )
        )}
      </div>

      <Popover anchor={menu?.kind === 'labels' ? menu.anchor : null} onClose={() => setMenu(null)}>
        <div className="menu-heading">Beri label:</div>
        {labels.length === 0 && <div className="menu-empty">Belum ada label.</div>}
        {labels.map((l) => (
          <MenuItem
            key={l.id}
            checked={threadLabelIds.has(l.id)}
            onClick={() => {
              setMenu(null);
              void act([threadId], threadLabelIds.has(l.id) ? 'label_remove' : 'label_add', { ...opts, labelId: l.id });
            }}
          >
            {l.name}
          </MenuItem>
        ))}
      </Popover>

      <Popover anchor={menu?.kind === 'msg' ? menu.anchor : null} onClose={() => setMenu(null)} align="end">
        {menu?.msg && (
          <>
            <MenuItem icon={<Reply size={18} />} onClick={() => (setMenu(null), void startReply('reply', menu.msg))}>
              Balas
            </MenuItem>
            <MenuItem icon={<ReplyAll size={18} />} onClick={() => (setMenu(null), void startReply('replyAll', menu.msg))}>
              Balas ke semua
            </MenuItem>
            <MenuItem icon={<Forward size={18} />} onClick={() => (setMenu(null), void startReply('forward', menu.msg))}>
              Teruskan
            </MenuItem>
            <div className="menu-divider" />
            <MenuItem icon={<Mail size={18} />} onClick={() => (setMenu(null), void messageAction(menu.msg!, 'unread', 'Pesan ditandai belum dibaca.'))}>
              Tandai belum dibaca
            </MenuItem>
            {menu.msg.folder === 'trash' || menu.msg.folder === 'spam' ? (
              <MenuItem icon={<Trash2 size={18} />} danger onClick={() => (setMenu(null), void messageAction(menu.msg!, 'delete', 'Pesan dihapus selamanya.'))}>
                Hapus pesan ini selamanya
              </MenuItem>
            ) : (
              <MenuItem icon={<Trash2 size={18} />} onClick={() => (setMenu(null), void messageAction(menu.msg!, 'trash', 'Pesan dipindahkan ke Sampah.'))}>
                Hapus pesan ini
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      <Popover anchor={menu?.kind === 'details' ? menu.anchor : null} onClose={() => setMenu(null)} className="details-pop">
        {menu?.msg && (
          <table className="details-table">
            <tbody>
              <tr>
                <th>dari:</th>
                <td>
                  <b>{menu.msg.from.name || menu.msg.from.address}</b> &lt;{menu.msg.from.address}&gt;
                </td>
              </tr>
              <tr>
                <th>kepada:</th>
                <td>{menu.msg.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ') || '—'}</td>
              </tr>
              {menu.msg.cc.length > 0 && (
                <tr>
                  <th>cc:</th>
                  <td>{menu.msg.cc.map(displayName).join(', ')}</td>
                </tr>
              )}
              {menu.msg.bcc.length > 0 && (
                <tr>
                  <th>bcc:</th>
                  <td>{menu.msg.bcc.map(displayName).join(', ')}</td>
                </tr>
              )}
              <tr>
                <th>tanggal:</th>
                <td>{formatFullDate(menu.msg.date)}</td>
              </tr>
              <tr>
                <th>subjek:</th>
                <td>{menu.msg.subject || '(tanpa subjek)'}</td>
              </tr>
              <tr>
                <th>dikirim oleh:</th>
                <td>{menu.msg.from.address.split('@')[1] ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Popover>
    </div>
  );
}
