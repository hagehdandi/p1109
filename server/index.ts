import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { HttpError } from './http';
import { cleanup } from './mail/mailbox';
import { startSmtpServer } from './mail/smtp';
import { api } from './routes';
import { seedDemoData } from './seed';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use('/api', api);

// Mode produksi: sajikan hasil build frontend (npm run build).
const webDir = path.resolve('dist/web');
const indexHtml = path.join(webDir, 'index.html');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https:",
  'img-src * data: blob:',
  "font-src 'self' data: https:",
  "connect-src 'self'",
  "frame-src 'self' about:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

if (fs.existsSync(indexHtml)) {
  app.use('/assets', express.static(path.join(webDir, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(webDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Frontend belum dibangun. Jalankan "npm run build" lalu "npm start", atau gunakan "npm run dev".');
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { code?: string; type?: string; status?: number; message?: string };
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (e.code === 'LIMIT_FILE_SIZE' || e.type === 'entity.too.large') {
    res.status(413).json({ error: 'Ukuran file melebihi batas 25 MB.' });
  } else if (e.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Format permintaan tidak valid.' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server. Coba lagi.' });
  }
});

seedDemoData();
cleanup();
setInterval(cleanup, 6 * 3600_000).unref();

app.listen(config.port, config.host, () => {
  console.log(`[web] ${config.appName} berjalan di http://localhost:${config.port} (domain: @${config.domain})`);
});
startSmtpServer();
