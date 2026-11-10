import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, 'dmails.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  prev_folder TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  date INTEGER NOT NULL,
  delivery_status TEXT,
  reply_to_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(user_id, folder, date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_msgid ON messages(user_id, message_id);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS message_labels (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, label_id)
);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
`);

export type UserRow = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  color: string;
  signature: string;
  created_at: number;
};
