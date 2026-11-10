import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  X,
} from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Addr, type AttachmentInfo, type Me, api, invalidateMail } from './api';
import { navigate } from './router';
import { Avatar, IconButton, useToast } from './ui';
import { displayName, formatSize, isEmail, parseAddressInput, signatureHtml } from './utils';

export type ComposeInit = {
  draftId?: number;
  to?: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject?: string;
  html?: string;
  replyToId?: number | null;
  attachments?: AttachmentInfo[];
  title?: string;
};

const UNDO_MS = 5000;
const MAX_FILE = 25 * 1024 * 1024;

/* ------------------------------------------------------ konteks compose */

type ComposeWindow = { key: number; init: ComposeInit };
const ComposeContext = createContext<{ open: (init?: ComposeInit) => void } | null>(null);

export function useCompose() {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error('useCompose harus dipakai di dalam ComposeProvider');
  return ctx;
}

export function ComposeProvider({ user, children }: { user: Me; children: ReactNode }) {
  const [windows, setWindows] = useState<ComposeWindow[]>([]);
  const open = useCallback((init: ComposeInit = {}) => {
    setWindows((list) => {
      if (init.draftId && list.some((w) => w.init.draftId === init.draftId)) return list;
      return [...list, { key: Date.now() + Math.random(), init }].slice(-3);
    });
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <ComposeContext.Provider value={value}>
      {children}
      <div className="compose-dock">
        {windows.map((w) => (
          <Composer
            key={w.key}
            init={w.init}
            user={user}
            variant="window"
            onClose={() => setWindows((list) => list.filter((x) => x.key !== w.key))}
          />
        ))}
      </div>
    </ComposeContext.Provider>
  );
}

/* --------------------------------------------------------- input penerima */

export function RecipientInput({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string;
  value: Addr[];
  onChange: (next: Addr[]) => void;
  autoFocus?: boolean;
  trailing?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = text.trim();
  const { data } = useQuery({
    queryKey: ['contacts', q],
    queryFn: () => api.get<Addr[]>(`/api/contacts?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const suggestions = q ? (data ?? []).filter((s) => !value.some((v) => v.address === s.address)) : [];
  const open = focused && suggestions.length > 0;

  const add = (items: Addr[]) => {
    const fresh = items.filter((a) => a.address && !value.some((v) => v.address === a.address));
    if (fresh.length) onChange([...value, ...fresh]);
    setText('');
    setActive(0);
  };

  return (
    <div className="field-row rcpt" onClick={() => inputRef.current?.focus()}>
      <span className="field-label">{label}</span>
      <div className="rcpt-chips">
        {value.map((a) => (
          <span key={a.address} className={`rcpt-chip${isEmail(a.address) ? '' : ' invalid'}`} title={a.address}>
            <Avatar name={a.name} email={a.address} size={22} />
            <span className="rcpt-chip-name">{displayName(a)}</span>
            <button
              type="button"
              aria-label={`Hapus ${displayName(a)}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v.address !== a.address));
              }}
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim()) add(parseAddressInput(text));
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) add(parseAddressInput(v));
            else {
              setText(v);
              setActive(0);
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (/[,;\n]/.test(pasted)) {
              e.preventDefault();
              add(parseAddressInput(text + pasted));
            }
          }}
          onKeyDown={(e) => {
            if (open && e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (i + 1) % suggestions.length);
            } else if (open && e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' || (e.key === 'Tab' && text.trim())) {
              if (!text.trim()) return;
              e.preventDefault();
              add(open ? [suggestions[active]] : parseAddressInput(text));
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {trailing}
      {open && (
        <ul className="rcpt-suggest" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.address}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                add([s]);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar name={s.name} email={s.address} size={32} />
              <div>
                <div className="rcpt-suggest-name">{s.name || s.address}</div>
                <div className="rcpt-suggest-addr">{s.address}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- composer */

const isBlankHtml = (html: string) =>
  !html
    .replace(/<div class="dm-signature">[\s\S]*$/, '')
    .replace(/<[^>]*>|&nbsp;|\s/g, '');

export function Composer({
  init,
  user,
  variant,
  onClose,
}: {
  init: ComposeInit;
  user: Me;
  variant: 'window' | 'inline';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState<Addr[]>(init.to ?? []);
  const [cc, setCc] = useState<Addr[]>(init.cc ?? []);
  const [bcc, setBcc] = useState<Addr[]>(init.bcc ?? []);
  const [showCc, setShowCc] = useState((init.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((init.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(init.subject ?? '');
  const [attachments, setAttachments] = useState<AttachmentInfo[]>(init.attachments ?? []);
  const [uploading, setUploading] = useState<{ key: string; name: string; size: number }[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [version, setVersion] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftIdRef = useRef<number | undefined>(init.draftId);
  const dirtyRef = useRef(false);
  const lockedRef = useRef(false);
  const savingRef = useRef<Promise<unknown>>(Promise.resolve());
  const rangeRef = useRef<Range | null>(null);

  const initialHtml = useMemo(
    () => init.html ?? `<div><br></div>${signatureHtml(user.signature) ? `<div><br></div>${signatureHtml(user.signature)}` : ''}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialHtml;
    if (variant === 'inline' || (init.to?.length ?? 0) > 0) {
      el.focus();
      const range = document.createRange();
      range.setStart(el, 0);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }, [initialHtml, variant, init.to]);

  const touch = () => {
    dirtyRef.current = true;
    setVersion((v) => v + 1);
  };

  // Pesan baru: sebelum pengguna mengetik, kursor ditempatkan di awal (di atas tanda tangan).
  const typedRef = useRef(false);
  const caretToStart = () => {
    const el = editorRef.current;
    if (!el || typedRef.current || init.html) return;
    const range = document.createRange();
    range.setStart(el.firstChild ?? el, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  };

  const collect = () => ({
    to,
    cc,
    bcc,
    subject,
    html: editorRef.current?.innerHTML ?? '',
    replyToId: init.replyToId ?? null,
    attachmentIds: attachments.map((a) => a.id),
  });

  const isEmpty = (data: ReturnType<typeof collect>) =>
    !data.to.length && !data.cc.length && !data.bcc.length && !data.subject.trim() && !data.attachmentIds.length && isBlankHtml(data.html);

  const saveDraft = () => {
    if (lockedRef.current) return savingRef.current;
    const data = collect();
    if (!draftIdRef.current && isEmpty(data)) return savingRef.current;
    dirtyRef.current = false;
    setSaveState('saving');
    const run = async () => {
      if (lockedRef.current) return;
      const res = await api.post<{ id: number }>('/api/drafts', { ...data, id: draftIdRef.current });
      draftIdRef.current = res.id;
      setSaveState('saved');
      void qc.invalidateQueries({ queryKey: ['counts'] });
      void qc.invalidateQueries({ queryKey: ['threads', 'drafts'] });
    };
    savingRef.current = savingRef.current.then(run, run).catch(() => setSaveState('idle'));
    return savingRef.current;
  };

  // Simpan draf otomatis 1,5 detik setelah perubahan terakhir.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const update =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      touch();
    };

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE) {
        toast.show(`"${file.name}" melebihi batas ukuran 25 MB.`);
        continue;
      }
      const key = `${file.name}-${Math.random()}`;
      setUploading((u) => [...u, { key, name: file.name, size: file.size }]);
      const form = new FormData();
      form.append('file', file);
      try {
        const att = await api.upload<AttachmentInfo>('/api/attachments', form);
        setAttachments((list) => [...list, att]);
        touch();
      } catch (err) {
        toast.show(`Gagal mengunggah "${file.name}": ${(err as Error).message}`);
      } finally {
        setUploading((u) => u.filter((x) => x.key !== key));
      }
    }
  }

  function exec(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    touch();
  }

  function openLink() {
    const sel = window.getSelection();
    rangeRef.current = sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl('https://');
    setLinkOpen(true);
  }

  function applyLink() {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url || url === 'https://') return;
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (rangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(rangeRef.current);
    }
    if (!sel || sel.isCollapsed) exec('insertHTML', `<a href="${href}">${href}</a>&nbsp;`);
    else exec('createLink', href);
  }

  async function handleSend() {
    const all = [...to, ...cc, ...bcc];
    if (!all.length) return toast.show('Tentukan setidaknya satu penerima.');
    const invalid = all.find((a) => !isEmail(a.address));
    if (invalid) return toast.show(`Alamat "${invalid.address}" tidak dikenali. Periksa kembali penerima.`);
    if (uploading.length) return toast.show('Tunggu hingga lampiran selesai diunggah.');

    lockedRef.current = true;
    setHidden(true);
    const payload = collect();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      toast.show({ message: 'Mengirim…', duration: 0 });
      try {
        await savingRef.current.catch(() => undefined);
        const res = await api.post<{ id: number; threadId: string }>('/api/send', { ...payload, draftId: draftIdRef.current });
        invalidateMail(qc);
        toast.show({ message: 'Pesan terkirim.', action: { label: 'Lihat pesan', onClick: () => navigate(`/mail/sent/${res.threadId}`) } });
        onClose();
      } catch (err) {
        lockedRef.current = false;
        setHidden(false);
        toast.show(`Pesan gagal dikirim: ${(err as Error).message}`);
      }
    }, UNDO_MS);
    toast.show({
      message: 'Mengirim pesan…',
      duration: UNDO_MS,
      action: {
        label: 'Urungkan',
        onClick: () => {
          cancelled = true;
          window.clearTimeout(timer);
          lockedRef.current = false;
          setHidden(false);
          toast.show('Pengiriman dibatalkan.');
        },
      },
    });
  }

  async function handleClose() {
    if (dirtyRef.current) await saveDraft();
    else await savingRef.current.catch(() => undefined);
    if (draftIdRef.current) toast.show('Draf disimpan.');
    onClose();
  }

  async function handleDiscard() {
    lockedRef.current = true;
    await savingRef.current.catch(() => undefined);
    if (draftIdRef.current) await api.del(`/api/drafts/${draftIdRef.current}`).catch(() => undefined);
    else await Promise.all(attachments.map((a) => api.del(`/api/attachments/${a.id}`).catch(() => undefined)));
    invalidateMail(qc);
    toast.show('Draf dihapus.');
    onClose();
  }

  const title = subject.trim() || init.title || 'Pesan Baru';
  const saveLabel = saveState === 'saving' ? 'Menyimpan…' : saveState === 'saved' ? 'Draf tersimpan' : '';
  const classes = ['composer', variant, minimized ? 'minimized' : '', fullscreen ? 'fullscreen' : '', hidden ? 'hidden' : '', dragging ? 'dragging' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {fullscreen && !minimized && !hidden && <div className="compose-backdrop" onClick={() => setFullscreen(false)} />}
      <section
        className={classes}
        aria-label={title}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void handleSend();
          }
        }}
      >
        {variant === 'window' && (
          <header className="composer-head" onClick={() => minimized && setMinimized(false)}>
            <span className="composer-title">{title}</span>
            <IconButton
              label={minimized ? 'Pulihkan' : 'Minimalkan'}
              small
              onClick={(e) => {
                e.stopPropagation();
                setMinimized((m) => !m);
              }}
            >
              <Minus size={18} />
            </IconButton>
            <IconButton
              label={fullscreen ? 'Keluar dari layar penuh' : 'Layar penuh'}
              small
              className="hide-mobile"
              onClick={(e) => {
                e.stopPropagation();
                setMinimized(false);
                setFullscreen((f) => !f);
              }}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </IconButton>
            <IconButton
              label="Simpan & tutup"
              small
              onClick={(e) => {
                e.stopPropagation();
                void handleClose();
              }}
            >
              <X size={18} />
            </IconButton>
          </header>
        )}

        {!minimized && (
          <>
            <div className="composer-fields">
              <RecipientInput
                label="Kepada"
                value={to}
                onChange={update(setTo)}
                autoFocus={variant === 'window' && !init.to?.length}
                trailing={
                  <span className="cc-toggles">
                    {!showCc && (
                      <button type="button" onClick={() => setShowCc(true)}>
                        Cc
                      </button>
                    )}
                    {!showBcc && (
                      <button type="button" onClick={() => setShowBcc(true)}>
                        Bcc
                      </button>
                    )}
                  </span>
                }
              />
              {showCc && <RecipientInput label="Cc" value={cc} onChange={update(setCc)} />}
              {showBcc && <RecipientInput label="Bcc" value={bcc} onChange={update(setBcc)} />}
              {variant === 'window' && (
                <div className="field-row">
                  <input
                    className="subject-input"
                    placeholder="Subjek"
                    aria-label="Subjek"
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      touch();
                    }}
                  />
                </div>
              )}
            </div>

            <div
              ref={editorRef}
              className="composer-editor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Isi pesan"
              onFocus={caretToStart}
              onMouseUp={(e) => e.target === e.currentTarget && caretToStart()}
              onInput={() => {
                typedRef.current = true;
                touch();
              }}
            />

            {(attachments.length > 0 || uploading.length > 0) && (
              <div className="composer-attachments">
                {attachments.map((a) => (
                  <div key={a.id} className="att-chip">
                    <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="att-chip-name">
                      {a.filename}
                    </a>
                    <span className="att-chip-size">({formatSize(a.size)})</span>
                    <IconButton
                      label="Hapus lampiran"
                      small
                      onClick={() => {
                        setAttachments((list) => list.filter((x) => x.id !== a.id));
                        touch();
                      }}
                    >
                      <X size={16} />
                    </IconButton>
                  </div>
                ))}
                {uploading.map((u) => (
                  <div key={u.key} className="att-chip uploading">
                    <Loader2 size={16} className="spin" />
                    <span className="att-chip-name">{u.name}</span>
                    <span className="att-chip-size">({formatSize(u.size)})</span>
                  </div>
                ))}
              </div>
            )}

            {formatting && (
              <div className="format-bar" onMouseDown={(e) => e.target !== e.currentTarget && e.preventDefault()}>
                <IconButton label="Tebal (Ctrl+B)" small onClick={() => exec('bold')}>
                  <Bold size={18} />
                </IconButton>
                <IconButton label="Miring (Ctrl+I)" small onClick={() => exec('italic')}>
                  <Italic size={18} />
                </IconButton>
                <IconButton label="Garis bawah (Ctrl+U)" small onClick={() => exec('underline')}>
                  <Underline size={18} />
                </IconButton>
                <IconButton label="Coret" small onClick={() => exec('strikeThrough')}>
                  <Strikethrough size={18} />
                </IconButton>
                <span className="format-sep" />
                <IconButton label="Daftar bernomor" small onClick={() => exec('insertOrderedList')}>
                  <ListOrdered size={18} />
                </IconButton>
                <IconButton label="Daftar berbutir" small onClick={() => exec('insertUnorderedList')}>
                  <List size={18} />
                </IconButton>
                <IconButton label="Kutipan" small onClick={() => exec('formatBlock', 'blockquote')}>
                  <Quote size={18} />
                </IconButton>
                <span className="format-sep" />
                <IconButton label="Hapus format" small onClick={() => exec('removeFormat')}>
                  <RemoveFormatting size={18} />
                </IconButton>
              </div>
            )}

            {linkOpen && (
              <form
                className="link-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyLink();
                }}
              >
                <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-label="Alamat tautan" />
                <button type="submit" className="btn text">
                  Terapkan
                </button>
                <IconButton label="Batal" small onClick={() => setLinkOpen(false)}>
                  <X size={16} />
                </IconButton>
              </form>
            )}

            <footer className="composer-foot">
              <button type="button" className="btn primary send-btn" onClick={() => void handleSend()}>
                Kirim
              </button>
              <IconButton label="Opsi pemformatan" active={formatting} onClick={() => setFormatting((f) => !f)}>
                <Type size={20} />
              </IconButton>
              <IconButton label="Lampirkan file" onClick={() => fileRef.current?.click()}>
                <Paperclip size={20} />
              </IconButton>
              <IconButton label="Sisipkan tautan" onClick={openLink}>
                <Link2 size={20} />
              </IconButton>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <span className="save-state">{saveLabel}</span>
              <IconButton label="Hapus draf" onClick={() => void handleDiscard()}>
                <Trash2 size={20} />
              </IconButton>
            </footer>
            {dragging && <div className="drop-overlay">Lepaskan file di sini</div>}
          </>
        )}
      </section>
    </>
  );
}
