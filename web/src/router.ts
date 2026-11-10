import { useSyncExternalStore } from 'react';
import type { View } from './api';

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener('popstate', callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('popstate', callback);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, replace = false) {
  if (to === snapshot()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((listener) => listener());
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, query: url.searchParams };
}

export type MailRoute = { view: View; labelId?: number; threadId?: string; q?: string; page: number };
export type Route = { kind: 'mail'; mail: MailRoute } | { kind: 'settings'; tab: string } | { kind: 'unknown' };

const VIEWS: View[] = ['inbox', 'starred', 'sent', 'drafts', 'all', 'spam', 'trash', 'search'];

export function parseRoute(path: string, query: URLSearchParams): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'settings') return { kind: 'settings', tab: parts[1] ?? 'general' };
  if (parts[0] !== 'mail') return { kind: 'unknown' };
  const page = Math.max(1, Number(query.get('page')) || 1);
  if (parts[1] === 'label' && Number(parts[2]) > 0) {
    return { kind: 'mail', mail: { view: 'label', labelId: Number(parts[2]), threadId: parts[3], page } };
  }
  const view = parts[1] as View;
  if (!VIEWS.includes(view)) return { kind: 'unknown' };
  return { kind: 'mail', mail: { view, threadId: parts[2], q: query.get('q') ?? undefined, page } };
}

export function mailPath(route: Partial<MailRoute> & { view: View }, threadId?: string) {
  const base = route.view === 'label' ? `/mail/label/${route.labelId}` : `/mail/${route.view}`;
  const path = threadId ? `${base}/${encodeURIComponent(threadId)}` : base;
  const params = new URLSearchParams();
  if (route.view === 'search' && route.q) params.set('q', route.q);
  if (!threadId && route.page && route.page > 1) params.set('page', String(route.page));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
