import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  FolderInput,
  Inbox,
  Mail,
  MailOpen,
  OctagonAlert,
  Paperclip,
  RotateCw,
  Search,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type DraftDetail, type Label, type ThreadList, type ThreadSummary, api, invalidateMail } from './api';
import { useCompose } from './Composer';
import { type MailRoute, mailPath, navigate } from './router';
import { Avatar, IconButton, MenuItem, Popover, useThreadActions, useToast } from './ui';
import { VIEW_TITLES, firstName, formatListDate, tint } from './utils';

export const PAGE_SIZE = 50;

export function threadsKey(route: MailRoute) {
  return ['threads', route.view, route.labelId ?? 0, route.q ?? '', route.page] as const;
}

export function fetchThreads(route: MailRoute) {
  const params = new URLSearchParams({ view: route.view, page: String(route.page), pageSize: String(PAGE_SIZE) });
  if (route.labelId) params.set('label', String(route.labelId));
  if (route.q) params.set('q', route.q);
  return api.get<ThreadList>(`/api/threads?${params}`);
}

function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <span
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      title={label}
      tabIndex={0}
      className={`checkbox${checked ? ' on' : ''}${indeterminate ? ' mixed' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          onChange();
        }
      }}
    />
  );
}

function senderLabel(item: ThreadSummary, view: MailRoute['view']): ReactNode {
  if (item.draftId) {
    return (
      <>
        <span className="draft-tag">Draf</span>
        {item.recipients.length > 0 && <span>, {item.recipients.join(', ')}</span>}
      </>
    );
  }
  if (view === 'sent') return <span>Kepada: {item.recipients.join(', ') || '(tanpa penerima)'}</span>;
  const ps = item.participants;
  if (ps.length === 1) return <span className={ps[0].unread ? 'b' : ''}>{ps[0].me ? 'saya' : ps[0].name}</span>;
  const shown = ps.length > 3 ? [ps[0], ps[ps.length - 2], ps[ps.length - 1]] : ps;
  return shown.map((p, i) => (
    <span key={p.address + i}>
      {i > 0 && (ps.length > 3 && i === 1 ? ' .. ' : ', ')}
      <span className={p.unread ? 'b' : ''}>{p.me ? 'saya' : firstName(p.name)}</span>
    </span>
  ));
}

const EMPTY: Record<string, string> = {
  inbox: 'Kotak masuk Anda kosong. Pesan baru akan muncul di sini.',
  starred: 'Tidak ada pesan berbintang. Beri bintang pada pesan agar mudah ditemukan nanti.',
  sent: 'Belum ada pesan terkirim.',
  drafts: 'Anda tidak memiliki draf yang tersimpan.',
  all: 'Tidak ada percakapan.',
  spam: 'Hore, tidak ada spam di sini!',
  trash: 'Tidak ada percakapan di Sampah.',
  label: 'Tidak ada percakapan dengan label ini.',
  search: 'Tidak ada pesan yang cocok dengan penelusuran Anda.',
};

export function MailList({ route, labels }: { route: MailRoute; labels: Label[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const compose = useCompose();
  const act = useThreadActions();
  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: threadsKey(route),
    queryFn: () => fetchThreads(route),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ kind: 'select' | 'more' | 'labels' | 'move'; anchor: HTMLElement } | null>(null);
  const routeKey = threadsKey(route).join('|');
  useEffect(() => setSelected(new Set()), [routeKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const chosen = items.filter((i) => selected.has(i.threadId));
  const ids = chosen.map((i) => i.threadId);
  const allOn = items.length > 0 && chosen.length === items.length;
  const view = route.view;
  const opts = { view, q: route.q };
  const total = data?.total ?? 0;
  const start = total ? (route.page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(total, route.page * PAGE_SIZE);
  const isTrashLike = view === 'trash' || view === 'spam';

  const run = async (action: Parameters<typeof act>[1], message?: string, extra: { labelId?: number; undo?: boolean } = {}) => {
    const n = ids.length;
    const ok = await act(ids, action, { ...opts, ...extra, message: message?.replace('{n}', String(n)) });
    if (ok) setSelected(new Set());
  };

  const selectBy = (pred: (i: ThreadSummary) => boolean) => setSelected(new Set(items.filter(pred).map((i) => i.threadId)));

  const openItem = async (item: ThreadSummary) => {
    if (item.draftId) {
      try {
        const d = await api.get<DraftDetail>(`/api/drafts/${item.draftId}`);
        compose.open({ draftId: d.id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, html: d.html, replyToId: d.replyToId, attachments: d.attachments });
      } catch (err) {
        toast.show((err as Error).message);
      }
      return;
    }
    navigate(mailPath(route, item.threadId));
  };

  const emptyFolder = async () => {
    const name = view === 'spam' ? 'Spam' : 'Sampah';
    if (!window.confirm(`Hapus permanen semua pesan di ${name}? Tindakan ini tidak dapat diurungkan.`)) return;
    await api.post('/api/threads/empty', { folder: view });
    invalidateMail(qc);
    toast.show(`${name} telah dikosongkan.`);
  };

  const anyUnread = chosen.some((i) => i.unread);
  const anyInInbox = chosen.some((i) => i.inInbox);
  const closeMenu = () => setMenu(null);

  const labelState = (l: Label) => {
    const n = chosen.filter((i) => i.labels.some((x) => x.id === l.id)).length;
    return n === 0 ? false : n === chosen.length ? true : 'mixed';
  };

  return (
    <div className="list-view">
      <div className="toolbar">
        <div className="toolbar-left">
          <div className="select-box">
            <Checkbox
              checked={allOn}
              indeterminate={chosen.length > 0 && !allOn}
              label="Pilih"
              onChange={() => setSelected(chosen.length ? new Set() : new Set(items.map((i) => i.threadId)))}
            />
            <button type="button" className="select-caret" aria-label="Opsi pilihan" onClick={(e) => setMenu({ kind: 'select', anchor: e.currentTarget })}>
              <ChevronDown size={16} />
            </button>
          </div>

          {chosen.length === 0 ? (
            <>
              <IconButton label="Muat ulang" onClick={() => void refetch()}>
                <RotateCw size={18} className={isFetching ? 'spin' : ''} />
              </IconButton>
              <IconButton label="Lainnya" onClick={(e) => setMenu({ kind: 'more', anchor: e.currentTarget })}>
                <EllipsisVertical size={18} />
              </IconButton>
            </>
          ) : view === 'drafts' ? (
            <button
              type="button"
              className="btn text"
              onClick={async () => {
                await Promise.all(chosen.map((i) => api.del(`/api/drafts/${i.draftId}`).catch(() => undefined)));
                invalidateMail(qc);
                setSelected(new Set());
                toast.show('Draf dihapus.');
              }}
            >
              Hapus draf
            </button>
          ) : isTrashLike ? (
            <>
              <button type="button" className="btn text" onClick={() => void run('delete', '{n} percakapan dihapus selamanya.', { undo: false })}>
                Hapus selamanya
              </button>
              <button type="button" className="btn text" onClick={() => void run('inbox', view === 'spam' ? '{n} percakapan ditandai bukan spam.' : '{n} percakapan dipulihkan.')}>
                {view === 'spam' ? 'Bukan spam' : 'Pulihkan'}
              </button>
            </>
          ) : (
            <>
              {anyInInbox ? (
                <IconButton label="Arsipkan" onClick={() => void run('archive', '{n} percakapan diarsipkan.')}>
                  <Archive size={18} />
                </IconButton>
              ) : (
                <IconButton label="Pindahkan ke Kotak Masuk" onClick={() => void run('inbox', '{n} percakapan dipindahkan ke Kotak Masuk.')}>
                  <ArchiveRestore size={18} />
                </IconButton>
              )}
              <IconButton label="Laporkan spam" onClick={() => void run('spam', '{n} percakapan ditandai sebagai spam.')}>
                <OctagonAlert size={18} />
              </IconButton>
              <IconButton label="Hapus" onClick={() => void run('trash', '{n} percakapan dipindahkan ke Sampah.')}>
                <Trash2 size={18} />
              </IconButton>
              <span className="toolbar-sep" />
              {anyUnread ? (
                <IconButton label="Tandai sudah dibaca" onClick={() => void run('read')}>
                  <MailOpen size={18} />
                </IconButton>
              ) : (
                <IconButton label="Tandai belum dibaca" onClick={() => void run('unread')}>
                  <Mail size={18} />
                </IconButton>
              )}
              <IconButton label="Pindahkan ke" onClick={(e) => setMenu({ kind: 'move', anchor: e.currentTarget })}>
                <FolderInput size={18} />
              </IconButton>
              <IconButton label="Label" onClick={(e) => setMenu({ kind: 'labels', anchor: e.currentTarget })}>
                <Tag size={18} />
              </IconButton>
            </>
          )}
        </div>
        <div className="toolbar-right">
          {total > 0 && (
            <span className="pager-text">
              {start}–{end} dari {total.toLocaleString('id-ID')}
            </span>
          )}
          <IconButton label="Lebih baru" disabled={route.page <= 1} onClick={() => navigate(mailPath({ ...route, page: route.page - 1 }))}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Lebih lama" disabled={end >= total} onClick={() => navigate(mailPath({ ...route, page: route.page + 1 }))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      <div className={`progress${isFetching && !isPending ? ' on' : ''}`} aria-hidden="true">
        <span />
      </div>

      {isTrashLike && items.length > 0 && (
        <div className="folder-banner">
          <span>
            {view === 'trash'
              ? 'Pesan di Sampah dapat dipulihkan sampai Anda menghapusnya secara permanen.'
              : 'Pesan yang ditandai spam tidak akan muncul di Kotak Masuk.'}
          </span>
          <button type="button" className="btn link" onClick={() => void emptyFolder()}>
            Kosongkan {view === 'trash' ? 'Sampah' : 'Spam'} sekarang
          </button>
        </div>
      )}

      {view === 'search' && (
        <div className="search-summary">
          <Search size={16} /> Hasil untuk <b>“{route.q}”</b>
        </div>
      )}

      <div className="list-scroll">
        {isPending ? (
          <ul className="thread-list skeleton" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="row">
                <span className="sk sk-a" />
                <span className="sk sk-b" />
                <span className="sk sk-c" />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <div className="empty">
            <p>{(error as Error).message}</p>
            <button type="button" className="btn outline" onClick={() => void refetch()}>
              Coba lagi
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <Inbox size={56} strokeWidth={1.2} />
            <p>{EMPTY[view]}</p>
            {view === 'sent' && (
              <button type="button" className="btn outline" onClick={() => compose.open()}>
                Tulis pesan
              </button>
            )}
          </div>
        ) : (
          <ul className="thread-list" aria-label={VIEW_TITLES[view]}>
            {items.map((item) => (
              <li
                key={item.draftId ?? item.threadId}
                className={`row${item.unread ? ' unread' : ''}${selected.has(item.threadId) ? ' selected' : ''}`}
                onClick={() => void openItem(item)}
              >
                <div className="row-controls">
                  <Checkbox
                    checked={selected.has(item.threadId)}
                    label="Pilih percakapan"
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(item.threadId)) next.delete(item.threadId);
                        else next.add(item.threadId);
                        return next;
                      })
                    }
                  />
                  {!item.draftId && (
                    <button
                      type="button"
                      className={`star-btn${item.starred ? ' on' : ''}`}
                      aria-label={item.starred ? 'Hapus bintang' : 'Beri bintang'}
                      title={item.starred ? 'Berbintang' : 'Tidak berbintang'}
                      onClick={(e) => {
                        e.stopPropagation();
                        void act([item.threadId], item.starred ? 'unstar' : 'star', opts);
                      }}
                    >
                      <Star size={18} />
                    </button>
                  )}
                </div>
                <span className="row-avatar">
                  <Avatar
                    name={item.participants[0]?.name ?? item.recipients[0]}
                    email={item.participants[0]?.address ?? item.recipients[0]}
                    size={36}
                  />
                </span>
                <div className="row-sender">
                  <span className="row-sender-text">{senderLabel(item, view)}</span>
                  {item.count > 1 && <span className="row-count">{item.count}</span>}
                </div>
                <div className="row-main">
                  {view !== 'inbox' && item.inInbox && !isTrashLike && <span className="chip neutral">Kotak Masuk</span>}
                  {item.labels
                    .filter((l) => !(view === 'label' && l.id === route.labelId))
                    .map((l) => (
                      <span key={l.id} className="chip" style={{ background: tint(l.color), color: l.color }}>
                        {l.name}
                      </span>
                    ))}
                  <span className="row-subject">{item.subject || '(tanpa subjek)'}</span>
                  {item.snippet && (
                    <span className="row-snippet">
                      <span className="row-dash">{'\u00a0– '}</span>
                      {item.snippet}
                    </span>
                  )}
                </div>
                {item.hasAttachments && <Paperclip size={16} className="row-clip" aria-label="Ada lampiran" />}
                <span className="row-date">{formatListDate(item.date)}</span>
                {!item.draftId && (
                  <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                    {isTrashLike ? (
                      <IconButton label={view === 'spam' ? 'Bukan spam' : 'Pulihkan'} small onClick={() => void act([item.threadId], 'inbox', { ...opts, message: 'Percakapan dipulihkan.' })}>
                        <ArchiveRestore size={18} />
                      </IconButton>
                    ) : item.inInbox ? (
                      <IconButton label="Arsipkan" small onClick={() => void act([item.threadId], 'archive', { ...opts, message: 'Percakapan diarsipkan.' })}>
                        <Archive size={18} />
                      </IconButton>
                    ) : null}
                    {isTrashLike ? (
                      <IconButton label="Hapus selamanya" small onClick={() => void act([item.threadId], 'delete', { ...opts, message: 'Percakapan dihapus selamanya.', undo: false })}>
                        <Trash2 size={18} />
                      </IconButton>
                    ) : (
                      <IconButton label="Hapus" small onClick={() => void act([item.threadId], 'trash', { ...opts, message: 'Percakapan dipindahkan ke Sampah.' })}>
                        <Trash2 size={18} />
                      </IconButton>
                    )}
                    <IconButton
                      label={item.unread ? 'Tandai sudah dibaca' : 'Tandai belum dibaca'}
                      small
                      onClick={() => void act([item.threadId], item.unread ? 'read' : 'unread', opts)}
                    >
                      {item.unread ? <MailOpen size={18} /> : <Mail size={18} />}
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Popover anchor={menu?.kind === 'select' ? menu.anchor : null} onClose={closeMenu}>
        {(
          [
            ['Semua', () => true],
            ['Tidak ada', () => false],
            ['Sudah dibaca', (i) => !i.unread],
            ['Belum dibaca', (i) => i.unread],
            ['Berbintang', (i) => i.starred],
            ['Tidak berbintang', (i) => !i.starred],
          ] as [string, (i: ThreadSummary) => boolean][]
        ).map(([name, pred]) => (
          <MenuItem
            key={name}
            onClick={() => {
              selectBy(pred);
              closeMenu();
            }}
          >
            {name}
          </MenuItem>
        ))}
      </Popover>

      <Popover anchor={menu?.kind === 'more' ? menu.anchor : null} onClose={closeMenu}>
        <MenuItem
          icon={<MailOpen size={18} />}
          onClick={async () => {
            closeMenu();
            const unread = items.filter((i) => i.unread).map((i) => i.threadId);
            if (!unread.length) return toast.show('Semua pesan di halaman ini sudah dibaca.');
            await act(unread, 'read', opts);
            toast.show(`${unread.length} percakapan ditandai sudah dibaca.`);
          }}
        >
          Tandai semua sudah dibaca
        </MenuItem>
      </Popover>

      <Popover anchor={menu?.kind === 'move' ? menu.anchor : null} onClose={closeMenu}>
        <div className="menu-heading">Pindahkan ke:</div>
        {view !== 'inbox' && (
          <MenuItem icon={<Inbox size={18} />} onClick={() => (closeMenu(), void run('inbox', '{n} percakapan dipindahkan ke Kotak Masuk.'))}>
            Kotak Masuk
          </MenuItem>
        )}
        <MenuItem icon={<OctagonAlert size={18} />} onClick={() => (closeMenu(), void run('spam', '{n} percakapan ditandai sebagai spam.'))}>
          Spam
        </MenuItem>
        <MenuItem icon={<Trash2 size={18} />} onClick={() => (closeMenu(), void run('trash', '{n} percakapan dipindahkan ke Sampah.'))}>
          Sampah
        </MenuItem>
        {labels.length > 0 && <div className="menu-divider" />}
        {labels.map((l) => (
          <MenuItem
            key={l.id}
            icon={<Tag size={18} color={l.color} />}
            onClick={async () => {
              closeMenu();
              await act(ids, 'label_add', { ...opts, labelId: l.id });
              if (anyInInbox) await act(ids, 'archive', opts);
              setSelected(new Set());
              toast.show(`${ids.length} percakapan dipindahkan ke "${l.name}".`);
            }}
          >
            {l.name}
          </MenuItem>
        ))}
      </Popover>

      <Popover anchor={menu?.kind === 'labels' ? menu.anchor : null} onClose={closeMenu}>
        <div className="menu-heading">Beri label:</div>
        {labels.length === 0 && <div className="menu-empty">Belum ada label. Buat label dari panel kiri.</div>}
        {labels.map((l) => {
          const state = labelState(l);
          return (
            <MenuItem
              key={l.id}
              checked={state === true}
              onClick={() => {
                closeMenu();
                void act(ids, state === true ? 'label_remove' : 'label_add', {
                  ...opts,
                  labelId: l.id,
                  message: state === true ? `Label "${l.name}" dihapus.` : `Label "${l.name}" diterapkan.`,
                  undo: false,
                });
              }}
            >
              {l.name}
            </MenuItem>
          );
        })}
      </Popover>
    </div>
  );
}
