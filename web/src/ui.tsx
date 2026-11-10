import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type Snapshot, type ThreadAction, type View, api, invalidateMail } from './api';
import { colorFor } from './utils';

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="2" y="6" width="36" height="28" rx="7" fill="#0b57d0" />
      <path d="M9 14l11 8.5L31 14" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ name, email, color, size = 40 }: { name?: string; email?: string; color?: string; size?: number }) {
  const label = (name || email || '?').trim();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: color ?? colorFor(email || label) }}
      aria-hidden="true"
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; small?: boolean };

export function IconButton({ label, active, small, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${small ? ' small' : ''}${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Menu/popover yang dirender di body dengan posisi tetap sehingga tidak terpotong kontainer bergulir. */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  className,
  matchWidth,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
  matchWidth?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const width = matchWidth ? a.width : undefined;
    const w = width ?? m.width;
    let top = a.bottom + 4;
    if (top + m.height > window.innerHeight - 8 && a.top - m.height - 4 > 8) top = a.top - m.height - 4;
    let left = align === 'end' ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ top, left, width });
  }, [anchor, align, matchWidth]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    const onResize = () => closeRef.current();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  checked,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button type="button" className={`menu-item${danger ? ' danger' : ''}`} role="menuitem" onClick={onClick}>
      {checked !== undefined && <span className={`menu-check${checked ? ' on' : ''}`} aria-hidden="true" />}
      {icon && <span className="menu-icon">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

export function Modal({ title, onClose, children, footer, width = 440 }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ toast */

type ToastInput = string | { message: string; action?: { label: string; onClick: () => void }; duration?: number };
type ToastData = { id: number; message: string; action?: { label: string; onClick: () => void }; duration: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void; hide: () => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const show = useCallback((t: ToastInput) => {
    const data = typeof t === 'string' ? { message: t } : t;
    setToast({ duration: 6000, ...data, id: Date.now() + Math.random() });
  }, []);
  const hide = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast || toast.duration <= 0) return;
    const timer = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const action = toast.action!;
                setToast(null);
                action.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <IconButton label="Tutup" small className="toast-close" onClick={() => setToast(null)}>
            <X size={18} />
          </IconButton>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus dipakai di dalam ToastProvider');
  return ctx;
}

/* ------------------------------------------------------ aksi percakapan */

export function useThreadActions() {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (
      threadIds: string[],
      action: ThreadAction,
      opts: { view: View; q?: string; labelId?: number; message?: string; undo?: boolean },
    ) => {
      try {
        const res = await api.post<{ undo: Snapshot[] }>('/api/threads/action', {
          threadIds,
          action,
          view: opts.view,
          q: opts.q,
          labelId: opts.labelId,
        });
        invalidateMail(qc);
        if (opts.message) {
          toast.show({
            message: opts.message,
            action:
              opts.undo !== false && res.undo.length
                ? {
                    label: 'Urungkan',
                    onClick: async () => {
                      await api.post('/api/messages/restore', { items: res.undo });
                      invalidateMail(qc);
                      toast.show('Tindakan diurungkan.');
                    },
                  }
                : undefined,
          });
        }
        return true;
      } catch (err) {
        toast.show((err as Error).message);
        return false;
      }
    },
    [qc, toast],
  );
}
