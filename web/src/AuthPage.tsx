import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { type AppConfig, type User, api } from './api';
import { navigate } from './router';
import { Logo } from './ui';

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoFocus,
  suffix,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
  suffix?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className={`outlined${value ? ' filled' : ''}${suffix ? ' with-suffix' : ''}`}>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        required
      />
      <span className="outlined-label">{label}</span>
      {suffix && <span className="outlined-suffix">{suffix}</span>}
      {hint && <span className="outlined-hint">{hint}</span>}
    </label>
  );
}

export function AuthPage({ config, mode }: { config: AppConfig; mode: 'login' | 'register' }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const isLogin = mode === 'login';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isLogin && form.password !== form.confirm) return setError('Sandi dan konfirmasi sandi tidak sama.');
    setBusy(true);
    try {
      const user = isLogin
        ? await api.post<User>('/api/auth/login', { email: form.email, password: form.password })
        : await api.post<User>('/api/auth/register', { name: form.name, username: form.username, password: form.password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['config'] });
      if (user) navigate('/mail/inbox', true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const switchMode = () => {
    setError('');
    navigate(isLogin ? '/register' : '/login');
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-intro">
          <Logo size={44} />
          <h1>{isLogin ? 'Masuk' : `Buat Akun ${config.appName}`}</h1>
          <p>{isLogin ? `Lanjutkan ke ${config.appName}` : 'Masukkan nama dan pilih alamat email Anda'}</p>
          {isLogin && config.demo && (
            <div className="demo-hint">
              <b>Akun demo</b>
              <span>raka@{config.domain}</span>
              <span>Sandi: demo12345</span>
            </div>
          )}
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          {isLogin ? (
            <Field label="Email atau nama pengguna" value={form.email} onChange={set('email')} autoFocus autoComplete="username" />
          ) : (
            <>
              <Field label="Nama lengkap" value={form.name} onChange={set('name')} autoFocus autoComplete="name" />
              <Field
                label="Nama pengguna"
                value={form.username}
                onChange={(v) => set('username')(v.toLowerCase().replace(/\s/g, ''))}
                suffix={`@${config.domain}`}
                autoComplete="username"
                hint="Anda dapat menggunakan huruf, angka, dan titik"
              />
            </>
          )}
          <Field
            label="Sandi"
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={set('password')}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            hint={isLogin ? undefined : 'Minimal 8 karakter'}
          />
          {!isLogin && (
            <Field
              label="Konfirmasi sandi"
              type={showPassword ? 'text' : 'password'}
              value={form.confirm}
              onChange={set('confirm')}
              autoComplete="new-password"
            />
          )}
          <label className="show-password">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />} Tampilkan sandi
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <div className="auth-actions">
            {(config.allowSignup || !isLogin) && (
              <button type="button" className="btn text" onClick={switchMode}>
                {isLogin ? 'Buat akun' : 'Masuk saja'}
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Memproses…' : isLogin ? 'Masuk' : 'Buat akun'}
            </button>
          </div>
        </form>
      </div>
      <footer className="auth-footer">
        <span>Bahasa Indonesia</span>
        <span>
          {config.appName} · @{config.domain}
        </span>
      </footer>
    </div>
  );
}
