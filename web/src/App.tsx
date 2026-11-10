import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  EllipsisVertical,
  File,
  Inbox,
  LogOut,
  Mails,
  Menu,
  OctagonAlert,
  Pencil,
  Plus,
  Search,
  Send,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type AppConfig, type Counts, type Label, type Me, type View, ApiError, api, invalidateMail } from './api';
import { AuthPage } from './AuthPage';
import { ComposeProvider, useCompose } from './Composer';
import { MailList } from './MailList';
import { type MailRoute, type Route, mailPath, navigate, parseRoute, useLocation } from './router';
import { LabelDialog, Settings } from './Settings';
import { ThreadView } from './ThreadView';
import { Avatar, IconButton, Logo, MenuItem, Modal, Popover, ToastProvider, useToast } from './ui';
import { VIEW_TITLES, formatSize, isTypingTarget } from './utils';

async function fetchMe() {
  try {
    return await api.get<Me>('/api/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function App() {
  const qc = useQueryClient();
  const { path } = useLocation();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/api/config'), staleTime: Infinity });
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 });

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    window.addEventListener('dmails:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dmails:unauthorized', onUnauthorized);
  }, [qc]);

  useEffect(() => {
    if (me.data === null && !path.startsWith('/login') && !path.startsWith('/register')) navigate('/login', true);
    if (me.data && (path === '/' || path.startsWith('/login') || path.startsWith('/register'))) navigate('/mail/inbox', true);
  }, [me.data, path]);

  if (config.isError || me.isError) {
    return (
      <div className="splash">
        <Logo size={56} />
        <p>Tidak dapat terhubung ke server.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Muat ulang
        </button>
      </div>
    );
  }
  if (!config.data || me.isPending) {
    return (
      <div className="splash">
        <Logo size={56} />
        <div className="splash-bar">
          <span />
        </div>
      </div>
    );
  }
  if (!me.data) return <AuthPage config={config.data} mode={path.startsWith('/register') ? 'register' : 'login'} />;
  return (
    <ToastProvider>
      <ComposeProvider user={me.data}>
        <MailApp user={me.data} config={config.data} />
      </ComposeProvider>
    </ToastProvider>
  );
}

function MailApp({ user, config }: { user: Me; config: AppConfig }) {
  const qc = useQueryClient();
  const compose = useCompose();
  const { path, query } = useLocation();
  const route: Route = parseRoute(path, query);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dm.sidebar') === 'collapsed');
  const [drawer, setDrawer] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const counts = useQuery({ queryKey: ['counts'], queryFn: () => api.get<Counts>('/api/counts'), refetchInterval: 60_000 });
  const labels = useQuery({ queryKey: ['labels'], queryFn: () => api.get<Label[]>('/api/labels') });

  useEffect(() => {
    if (route.kind === 'unknown') navigate('/mail/inbox', true);
  }, [route.kind]);

  useEffect(() => setDrawer(false), [path]);

  // Pembaruan real-time saat ada email masuk.
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('mail', () => invalidateMail(qc));
    return () => source.close();
  }, [qc]);

  useEffect(() => {
    const density = localStorage.getItem('dm.density') ?? 'default';
    document.body.dataset.density = density;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'c') {
        e.preventDefault();
        compose.open();
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      } else if (e.key === '?') {
        setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compose]);

  const mail = route.kind === 'mail' ? route.mail : null;
  const labelList = labels.data ?? [];
  const currentLabel = mail?.view === 'label' ? labelList.find((l) => l.id === mail.labelId) : undefined;
  const unread = counts.data?.inbox ?? 0;

  useEffect(() => {
    const section = route.kind === 'settings' ? 'Setelan' : currentLabel ? currentLabel.name : mail ? VIEW_TITLES[mail.view] : '';
    document.title = `${section}${unread && mail?.view === 'inbox' ? ` (${unread})` : ''} - ${user.email} - ${config.appName}`;
  }, [route.kind, mail, currentLabel, unread, user.email, config.appName]);

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setDrawer((d) => !d);
      return;
    }
    setCollapsed((c) => {
      localStorage.setItem('dm.sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <Header user={user} config={config} mail={mail} onMenu={toggleSidebar} />
      <div className="app-body">
        <Sidebar mail={mail} counts={counts.data} labels={labelList} user={user} />
        {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
        <main className="main-panel">
          {route.kind === 'settings' ? (
            <Settings user={user} config={config} tab={route.tab} labels={labelList} />
          ) : mail?.threadId ? (
            <ThreadView key={mail.threadId} route={mail} labels={labelList} user={user} />
          ) : mail ? (
            <MailList route={mail} labels={labelList} />
          ) : null}
        </main>
      </div>
      <button type="button" className="fab" onClick={() => compose.open()} aria-label="Tulis">
        <Pencil size={22} />
        <span>Tulis</span>
      </button>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}

/* ----------------------------------------------------------------- header */

function Header({ user, config, mail, onMenu }: { user: Me; config: AppConfig; mail: MailRoute | null; onMenu: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [advanced, setAdvanced] = useState<HTMLElement | null>(null);
  const [account, setAccount] = useState<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [adv, setAdv] = useState({ from: '', to: '', subject: '', words: '', attachment: false });

  useEffect(() => {
    setQ(mail?.view === 'search' ? (mail.q ?? '') : '');
  }, [mail?.view, mail?.q]);

  const search = (value: string) => {
    const text = value.trim();
    if (text) navigate(mailPath({ view: 'search', q: text }));
  };

  const submitAdvanced = (e: FormEvent) => {
    e.preventDefault();
    const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
    const parts = [
      adv.from && `from:${quote(adv.from.trim())}`,
      adv.to && `to:${quote(adv.to.trim())}`,
      adv.subject && `subject:${quote(adv.subject.trim())}`,
      adv.words.trim(),
      adv.attachment && 'has:attachment',
    ].filter(Boolean);
    setAdvanced(null);
    if (parts.length) search(parts.join(' '));
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    qc.setQueryData(['me'], null);
    navigate('/login', true);
  };

  return (
    <header className="header">
      <div className="header-left">
        <IconButton label="Menu utama" onClick={onMenu}>
          <Menu size={22} />
        </IconButton>
        <a
          className="brand"
          href="/mail/inbox"
          onClick={(e) => {
            e.preventDefault();
            navigate('/mail/inbox');
          }}
        >
          <Logo size={34} />
          <span>{config.appName}</span>
        </a>
      </div>

      <form
        ref={formRef}
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <IconButton label="Telusuri" type="submit">
          <Search size={20} />
        </IconButton>
        <input id="search-input" placeholder="Telusuri email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Telusuri email" autoComplete="off" />
        {q && (
          <IconButton
            label="Hapus penelusuran"
            onClick={() => {
              setQ('');
              if (mail?.view === 'search') navigate('/mail/inbox');
            }}
          >
            <X size={20} />
          </IconButton>
        )}
        <IconButton label="Tampilkan opsi penelusuran" onClick={() => setAdvanced(advanced ? null : formRef.current)}>
          <SlidersHorizontal size={20} />
        </IconButton>
      </form>

      <div className="header-right">
        <IconButton label="Pintasan keyboard" className="hide-mobile" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}>
          <CircleHelp size={22} />
        </IconButton>
        <IconButton label="Setelan" className="hide-mobile" onClick={() => navigate('/settings')}>
          <SettingsIcon size={22} />
        </IconButton>
        <button type="button" className="account-btn" title={`${user.name}\n${user.email}`} aria-label="Akun" onClick={(e) => setAccount(e.currentTarget)}>
          <Avatar name={user.name} email={user.email} color={user.color} size={34} />
        </button>
      </div>

      <Popover anchor={advanced} onClose={() => setAdvanced(null)} matchWidth className="adv-search">
        <form onSubmit={submitAdvanced}>
          {(
            [
              ['from', 'Dari'],
              ['to', 'Kepada'],
              ['subject', 'Subjek'],
              ['words', 'Berisi kata'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="adv-row">
              <span>{label}</span>
              <input value={adv[key]} onChange={(e) => setAdv({ ...adv, [key]: e.target.value })} />
            </label>
          ))}
          <label className="adv-check">
            <input type="checkbox" checked={adv.attachment} onChange={(e) => setAdv({ ...adv, attachment: e.target.checked })} />
            Memiliki lampiran
          </label>
          <div className="adv-actions">
            <button type="button" className="btn text" onClick={() => setAdv({ from: '', to: '', subject: '', words: '', attachment: false })}>
              Hapus filter
            </button>
            <button type="submit" className="btn primary">
              Telusuri
            </button>
          </div>
        </form>
      </Popover>

      <Popover anchor={account} onClose={() => setAccount(null)} align="end" className="account-pop">
        <div className="account-card">
          <div className="account-email">{user.email}</div>
          <Avatar name={user.name} email={user.email} color={user.color} size={72} />
          <div className="account-hello">Halo, {user.name.split(' ')[0]}!</div>
          <button
            type="button"
            className="btn outline"
            onClick={() => {
              setAccount(null);
              navigate('/settings/account');
            }}
          >
            Kelola akun {config.appName} Anda
          </button>
          <button type="button" className="btn tonal account-logout" onClick={() => void logout()}>
            <LogOut size={18} /> Keluar
          </button>
          <div className="account-foot">
            Penyimpanan: {formatSize(user.storageUsed)} dari {formatSize(user.storageQuota)}
          </div>
        </div>
      </Popover>
    </header>
  );
}

/* ---------------------------------------------------------------- sidebar */

type NavDef = { view: View; label: string; icon: ReactNode; count?: number; strong?: boolean };

function Sidebar({ mail, counts, labels, user }: { mail: MailRoute | null; counts?: Counts; labels: Label[]; user: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const compose = useCompose();
  const [more, setMore] = useState(() => localStorage.getItem('dm.more') === '1');
  const [dialog, setDialog] = useState<{ label?: Label } | null>(null);
  const [labelMenu, setLabelMenu] = useState<{ anchor: HTMLElement; label: Label } | null>(null);

  const primary: NavDef[] = [
    { view: 'inbox', label: 'Kotak Masuk', icon: <Inbox size={20} />, count: counts?.inbox, strong: true },
    { view: 'starred', label: 'Berbintang', icon: <Star size={20} /> },
    { view: 'sent', label: 'Terkirim', icon: <Send size={20} /> },
    { view: 'drafts', label: 'Draf', icon: <File size={20} />, count: counts?.drafts },
  ];
  const secondary: NavDef[] = [
    { view: 'all', label: 'Semua Email', icon: <Mails size={20} /> },
    { view: 'spam', label: 'Spam', icon: <OctagonAlert size={20} />, count: counts?.spam, strong: true },
    { view: 'trash', label: 'Sampah', icon: <Trash2 size={20} /> },
  ];

  const item = (def: NavDef) => {
    const active = mail?.view === def.view;
    const count = def.count ?? 0;
    return (
      <a
        key={def.view}
        href={`/mail/${def.view}`}
        className={`nav-item${active ? ' active' : ''}${def.strong && count > 0 ? ' has-unread' : ''}`}
        title={def.label}
        aria-current={active ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/mail/${def.view}`);
        }}
      >
        <span className="nav-icon">{def.icon}</span>
        <span className="nav-label">{def.label}</span>
        {count > 0 && <span className="nav-count">{count.toLocaleString('id-ID')}</span>}
      </a>
    );
  };

  const deleteLabel = async (label: Label) => {
    if (!window.confirm(`Hapus label "${label.name}"? Pesan dengan label ini tidak akan terhapus.`)) return;
    await api.del(`/api/labels/${label.id}`);
    void qc.invalidateQueries({ queryKey: ['labels'] });
    invalidateMail(qc);
    toast.show(`Label "${label.name}" dihapus.`);
    if (mail?.view === 'label' && mail.labelId === label.id) navigate('/mail/inbox');
  };

  const used = Math.min(100, (user.storageUsed / user.storageQuota) * 100);

  return (
    <aside className="sidebar" aria-label="Navigasi">
      <div className="compose-wrap">
        <button type="button" className="compose-btn" onClick={() => compose.open()} title="Tulis">
          <Pencil size={22} />
          <span>Tulis</span>
        </button>
      </div>
      <nav className="nav">
        {primary.map(item)}
        {more && secondary.map(item)}
        <button
          type="button"
          className="nav-item"
          title={more ? 'Lebih sedikit' : 'Selengkapnya'}
          onClick={() => {
            localStorage.setItem('dm.more', more ? '0' : '1');
            setMore(!more);
          }}
        >
          <span className="nav-icon">{more ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</span>
          <span className="nav-label">{more ? 'Lebih sedikit' : 'Selengkapnya'}</span>
        </button>
      </nav>

      <div className="labels-head">
        <span>Label</span>
        <IconButton label="Buat label baru" small onClick={() => setDialog({})}>
          <Plus size={18} />
        </IconButton>
      </div>
      <nav className="nav">
        {labels.map((l) => {
          const active = mail?.view === 'label' && mail.labelId === l.id;
          const count = counts?.labels[l.id] ?? 0;
          return (
            <a
              key={l.id}
              href={`/mail/label/${l.id}`}
              className={`nav-item label-item${active ? ' active' : ''}${count ? ' has-unread' : ''}`}
              title={l.name}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/mail/label/${l.id}`);
              }}
            >
              <span className="nav-icon">
                <Tag size={18} color={l.color} fill={l.color} />
              </span>
              <span className="nav-label">{l.name}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
              <button
                type="button"
                className="nav-more"
                aria-label={`Opsi label ${l.name}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLabelMenu({ anchor: e.currentTarget, label: l });
                }}
              >
                <EllipsisVertical size={16} />
              </button>
            </a>
          );
        })}
      </nav>

      <div className="storage">
        <div className="storage-bar">
          <span style={{ width: `${Math.max(used, 1)}%` }} />
        </div>
        <div className="storage-text">
          {formatSize(user.storageUsed)} dari {formatSize(user.storageQuota)} terpakai
        </div>
      </div>

      <Popover anchor={labelMenu?.anchor ?? null} onClose={() => setLabelMenu(null)}>
        {labelMenu && (
          <>
            <MenuItem
              icon={<Pencil size={16} />}
              onClick={() => {
                setDialog({ label: labelMenu.label });
                setLabelMenu(null);
              }}
            >
              Edit label
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={16} />}
              danger
              onClick={() => {
                const label = labelMenu.label;
                setLabelMenu(null);
                void deleteLabel(label);
              }}
            >
              Hapus label
            </MenuItem>
          </>
        )}
      </Popover>
      {dialog && <LabelDialog label={dialog.label} onClose={() => setDialog(null)} />}
    </aside>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['c', 'Tulis pesan baru'],
    ['/', 'Telusuri email'],
    ['r / a / f', 'Balas / Balas ke semua / Teruskan'],
    ['e', 'Arsipkan percakapan'],
    ['#', 'Hapus percakapan'],
    ['j / k', 'Percakapan berikutnya / sebelumnya'],
    ['u', 'Kembali ke daftar'],
    ['Ctrl + Enter', 'Kirim pesan'],
  ];
  return (
    <Modal
      title="Pintasan keyboard"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <table className="shortcut-table">
        <tbody>
          {rows.map(([key, desc]) => (
            <tr key={key}>
              <td>
                <kbd>{key}</kbd>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
