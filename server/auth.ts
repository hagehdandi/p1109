import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { db, type UserRow } from './db';
import { fail } from './http';

const COOKIE = 'dmails_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function createSession(res: Response, userId: number): void {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + SESSION_TTL,
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: SESSION_TTL,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response): void {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function currentUser(req: Request): UserRow | undefined {
  const token = readCookie(req, COOKIE);
  if (!token) return undefined;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(sha256(token), Date.now()) as UserRow | undefined;
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req);
  if (!user) return fail(res, 401, 'Sesi Anda telah berakhir. Silakan masuk kembali.');
  res.locals.user = user;
  next();
}

export const userOf = (res: Response) => res.locals.user as UserRow;

// Pembatasan percobaan login sederhana per alamat IP.
const failures = new Map<string, { count: number; resetAt: number }>();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export function isThrottled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW });
  else entry.count += 1;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
