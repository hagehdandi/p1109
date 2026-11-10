import fs from 'node:fs';
import { SMTPServer } from 'smtp-server';
import { config } from '../config';
import { findUserByEmail, isLocalAddress, receiveInbound } from './delivery';

function smtpError(message: string, code: number): Error {
  const err = new Error(message) as Error & { responseCode: number };
  err.responseCode = code;
  return err;
}

/** Server SMTP penerima (MX) untuk domain lokal. Tidak menerima relay maupun AUTH. */
export function startSmtpServer(): SMTPServer | null {
  if (!config.smtp.enabled) {
    console.log('[smtp] dinonaktifkan (SMTP_ENABLED=false)');
    return null;
  }
  const tls =
    config.smtp.tlsKey && config.smtp.tlsCert
      ? { key: fs.readFileSync(config.smtp.tlsKey), cert: fs.readFileSync(config.smtp.tlsCert) }
      : null;

  const server = new SMTPServer({
    name: config.smtp.hostname,
    banner: `${config.appName} ESMTP`,
    size: config.maxMessageBytes,
    authOptional: true,
    disabledCommands: tls ? ['AUTH'] : ['AUTH', 'STARTTLS'],
    ...(tls ?? {}),
    logger: false,
    onRcptTo(address, _session, callback) {
      const rcpt = address.address.toLowerCase();
      if (!isLocalAddress(rcpt)) return callback(smtpError('5.7.1 Relay access denied', 554));
      if (!findUserByEmail(rcpt)) return callback(smtpError(`5.1.1 <${rcpt}>: Recipient address rejected: User unknown`, 550));
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', (err: Error) => callback(err));
      stream.on('end', () => {
        if (stream.sizeExceeded) return callback(smtpError('5.3.4 Message too big', 552));
        const rcpts = session.envelope.rcptTo.map((r) => r.address);
        const mailFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined;
        receiveInbound(Buffer.concat(chunks), rcpts, mailFrom).then(
          () => callback(),
          (err: Error) => {
            console.error('[smtp] gagal memproses pesan:', err);
            callback(smtpError('4.3.0 Gagal memproses pesan, coba lagi nanti', 451));
          },
        );
      });
    },
  });
  server.on('error', (err) => console.error('[smtp]', err.message));
  server.listen(config.smtp.port, config.smtp.host, () => {
    console.log(`[smtp] menerima email untuk @${config.domain} di ${config.smtp.host}:${config.smtp.port}`);
  });
  return server;
}
