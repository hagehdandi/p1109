import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // .env bersifat opsional
}

const env = process.env;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const domain = (env.MAIL_DOMAIN || 'dmails.local').trim().toLowerCase();

export type OutboundMode = 'relay' | 'direct' | 'disabled';

export const config = {
  appName: env.APP_NAME || 'Dmails',
  domain,
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  allowSignup: bool(env.ALLOW_SIGNUP, true),
  seedDemo: bool(env.SEED_DEMO, true),
  cookieSecure: bool(env.COOKIE_SECURE, false),
  quotaBytes: Number(env.USER_QUOTA_MB || 1024) * 1024 * 1024,
  maxMessageBytes: 25 * 1024 * 1024,
  smtp: {
    enabled: bool(env.SMTP_ENABLED, true),
    host: env.SMTP_HOST || '0.0.0.0',
    port: Number(env.SMTP_PORT || 2525),
    hostname: env.SMTP_HOSTNAME || `mail.${domain}`,
    tlsKey: env.SMTP_TLS_KEY || '',
    tlsCert: env.SMTP_TLS_CERT || '',
  },
  outbound: {
    mode: (env.OUTBOUND_MODE || (env.RELAY_HOST ? 'relay' : 'disabled')) as OutboundMode,
    relayHost: env.RELAY_HOST || '',
    relayPort: Number(env.RELAY_PORT || 587),
    relaySecure: bool(env.RELAY_SECURE, false),
    relayUser: env.RELAY_USER || '',
    relayPass: env.RELAY_PASS || '',
    dkimSelector: env.DKIM_SELECTOR || '',
    dkimKeyFile: env.DKIM_PRIVATE_KEY_FILE || '',
  },
};
