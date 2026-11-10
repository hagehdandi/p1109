import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { type AppConfig, type Label, type Me, api, invalidateMail } from './api';
import { navigate } from './router';
import { Avatar, IconButton, Modal, useToast } from './ui';
import { formatSize } from './utils';

const LABEL_COLORS = ['#1a73e8', '#188038', '#e37400', '#d93025', '#9334e6', '#007b83', '#b06000', '#c5221f', '#3367d6', '#5f6368', '#e8710a', '#0b8043'];

export function LabelDialog({ label, onClose }: { label?: Label; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState(label?.color ?? LABEL_COLORS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return setError('Masukkan nama label.');
    setBusy(true);
    try {
      if (label) await api.patch(`/api/labels/${label.id}`, { name, color });
      else await api.post('/api/labels', { name, color });
      void qc.invalidateQueries({ queryKey: ['labels'] });
      invalidateMail(qc);
      toast.show(label ? 'Label diperbarui.' : `Label "${name.trim()}" dibuat.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={label ? 'Edit label' : 'Label baru'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn text" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {label ? 'Simpan' : 'Buat'}
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        <label className="form-label" htmlFor="label-name">
          Nama label
        </label>
        <input id="label-name" className="text-input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="form-label">Warna</div>
        <div className="swatches">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${c === color ? ' on' : ''}`}
              style={{ background: c }}
              aria-label={`Warna ${c}`}
              onClick={() => setColor(c)}
            >
              {c === color && <Check size={16} color="#fff" />}
            </button>
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  );
}

const TABS = [
  ['general', 'Umum'],
  ['labels', 'Label'],
  ['account', 'Akun & server'],
] as const;

export function Settings({ user, config, tab, labels }: { user: Me; config: AppConfig; tab: string; labels: Label[] }) {
  const current = TABS.some(([id]) => id === tab) ? tab : 'general';
  return (
    <div className="settings">
      <div className="settings-head">
        <h1>Setelan</h1>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <a
              key={id}
              href={`/settings/${id}`}
              className={`tab${current === id ? ' active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/settings/${id}`, true);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
      <div className="settings-body">
        {current === 'general' && <GeneralTab user={user} />}
        {current === 'labels' && <LabelsTab labels={labels} />}
        {current === 'account' && <AccountTab user={user} config={config} />}
      </div>
    </div>
  );
}

function GeneralTab({ user }: { user: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [signature, setSignature] = useState(user.signature);
  const [density, setDensity] = useState(localStorage.getItem('dm.density') ?? 'default');
  const [busy, setBusy] = useState(false);
  const dirty = name !== user.name || signature !== user.signature || density !== (localStorage.getItem('dm.density') ?? 'default');

  async function save() {
    setBusy(true);
    try {
      await api.patch('/api/me', { name, signature });
      localStorage.setItem('dm.density', density);
      document.body.dataset.density = density;
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.show('Setelan disimpan.');
    } catch (err) {
      toast.show((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="setting-row">
        <div className="setting-label">Nama pengirim</div>
        <div className="setting-control">
          <input className="text-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <p className="setting-help">Nama yang terlihat oleh penerima pada email yang Anda kirim.</p>
        </div>
      </section>
      <section className="setting-row">
        <div className="setting-label">Tanda tangan</div>
        <div className="setting-control">
          <textarea className="text-input" rows={5} value={signature} maxLength={2000} placeholder="Contoh: Nama · Jabatan · Nomor telepon" onChange={(e) => setSignature(e.target.value)} />
          <p className="setting-help">Ditambahkan otomatis di akhir setiap pesan baru, balasan, dan terusan.</p>
        </div>
      </section>
      <section className="setting-row">
        <div className="setting-label">Kepadatan tampilan</div>
        <div className="setting-control radios">
          {(
            [
              ['default', 'Standar'],
              ['comfortable', 'Nyaman'],
              ['compact', 'Ringkas'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="radio">
              <input type="radio" name="density" checked={density === value} onChange={() => setDensity(value)} />
              {label}
            </label>
          ))}
        </div>
      </section>
      <div className="settings-actions">
        <button type="button" className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>
          Simpan perubahan
        </button>
        <button
          type="button"
          className="btn text"
          disabled={!dirty}
          onClick={() => {
            setName(user.name);
            setSignature(user.signature);
            setDensity(localStorage.getItem('dm.density') ?? 'default');
          }}
        >
          Batal
        </button>
      </div>
    </>
  );
}

function LabelsTab({ labels }: { labels: Label[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ label?: Label } | null>(null);

  async function remove(label: Label) {
    if (!window.confirm(`Hapus label "${label.name}"? Pesan dengan label ini tidak akan terhapus.`)) return;
    await api.del(`/api/labels/${label.id}`);
    void qc.invalidateQueries({ queryKey: ['labels'] });
    invalidateMail(qc);
    toast.show(`Label "${label.name}" dihapus.`);
  }

  return (
    <>
      <div className="labels-table">
        <div className="labels-table-head">
          <span>Label</span>
          <span>Tindakan</span>
        </div>
        {labels.length === 0 && <p className="setting-help">Anda belum memiliki label.</p>}
        {labels.map((l) => (
          <div key={l.id} className="labels-table-row">
            <span className="labels-table-name">
              <Tag size={18} color={l.color} fill={l.color} /> {l.name}
            </span>
            <span className="labels-table-actions">
              <IconButton label="Edit" small onClick={() => setDialog({ label: l })}>
                <Pencil size={16} />
              </IconButton>
              <IconButton label="Hapus" small onClick={() => void remove(l)}>
                <Trash2 size={16} />
              </IconButton>
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="btn outline" onClick={() => setDialog({})}>
        <Plus size={18} /> Buat label baru
      </button>
      {dialog && <LabelDialog label={dialog.label} onClose={() => setDialog(null)} />}
    </>
  );
}

function AccountTab({ user, config }: { user: Me; config: AppConfig }) {
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const used = Math.min(100, (user.storageUsed / user.storageQuota) * 100);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.next !== pw.confirm) return setError('Konfirmasi sandi baru tidak sama.');
    try {
      await api.post('/api/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.show('Sandi berhasil diubah.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const outbound = { relay: 'SMTP relay', direct: 'Langsung ke server MX', disabled: 'Belum dikonfigurasi (hanya antar-pengguna lokal)' }[config.outboundMode];

  return (
    <>
      <section className="setting-row">
        <div className="setting-label">Akun</div>
        <div className="setting-control account-summary">
          <Avatar name={user.name} email={user.email} color={user.color} size={48} />
          <div>
            <div className="b">{user.name}</div>
            <div className="muted">{user.email}</div>
          </div>
        </div>
      </section>
      <section className="setting-row">
        <div className="setting-label">Penyimpanan</div>
        <div className="setting-control">
          <div className="storage-bar wide">
            <span style={{ width: `${Math.max(used, 1)}%` }} />
          </div>
          <p className="setting-help">
            {formatSize(user.storageUsed)} dari {formatSize(user.storageQuota)} terpakai
          </p>
        </div>
      </section>
      <section className="setting-row">
        <div className="setting-label">Ubah sandi</div>
        <form className="setting-control stack" onSubmit={changePassword}>
          <input className="text-input" type="password" placeholder="Sandi saat ini" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input className="text-input" type="password" placeholder="Sandi baru (min. 8 karakter)" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <input className="text-input" type="password" placeholder="Konfirmasi sandi baru" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          {error && <div className="form-error">{error}</div>}
          <div>
            <button type="submit" className="btn primary" disabled={!pw.current || !pw.next}>
              Ubah sandi
            </button>
          </div>
        </form>
      </section>
      <section className="setting-row">
        <div className="setting-label">Informasi server</div>
        <div className="setting-control">
          <dl className="server-info">
            <dt>Domain email</dt>
            <dd>@{config.domain}</dd>
            <dt>SMTP masuk (MX)</dt>
            <dd>{config.smtp.enabled ? `${config.smtp.hostname} · port ${config.smtp.port}` : 'Nonaktif'}</dd>
            <dt>Pengiriman keluar</dt>
            <dd>{outbound}</dd>
          </dl>
        </div>
      </section>
    </>
  );
}
