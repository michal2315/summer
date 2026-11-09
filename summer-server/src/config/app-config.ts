import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_MIGRATE_ON_START: z.stringbool().default(false),

  AUTH_PROVIDER: z.enum(['dev', 'sso']).default('dev'),
  DEV_TOKEN_SECRET: z.string().optional(),
  DEV_LOGIN_USER: z.string().default('mgolan'),
  AUTH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),

  PERMISSION_ADMIN_GROUPS: csv,

  APP_TIMEZONE: z.string().default('Asia/Jerusalem'),

  UPLOAD_DIR: z.string().default('.data/uploads'),
  MAX_FILE_MB: z.coerce.number().positive().default(50),
  MAX_FILES_PER_SUMMARY: z.coerce.number().int().positive().default(20),
  EXPORT_MAX: z.coerce.number().int().positive().default(5000),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(2000),

  EXTENSION_DIR: z.string().default('../summer-extension-dist'),

  /** Where the client is served; links in e-mails point here. */
  APP_URL: z.string().url().default('http://localhost:81'),
  MAIL_TRANSPORT: z.enum(['graph', 'smtp', 'log']).default('log'),
  SMTP_URL: z.string().optional(),
  /** `Name <address>`. With MAIL_TRANSPORT=graph the address is the mailbox mail is sent from. */
  MAIL_FROM: z.string().default('Summer <summer@localhost>'),
  /** Microsoft Graph (an Entra app with the Mail.Send application permission). */
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  /** Send every mail here instead of to its recipient (testing on real data). */
  MAIL_REDIRECT_TO: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  /** With MAIL_TRANSPORT=log, also write each mail as an .html file here, to open in a browser. */
  MAIL_PREVIEW_DIR: z.string().default(''),
  /** How often the mail worker looks for pending e-mails; 0 turns it off. */
  MAIL_POLL_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Local hour (APP_TIMEZONE) the daily digest goes out. */
  DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(8),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const e = parsed.data;
  if (e.AUTH_PROVIDER === 'dev') {
    if (e.NODE_ENV === 'production') throw new Error('AUTH_PROVIDER=dev is refused when NODE_ENV=production');
    if (!e.DEV_TOKEN_SECRET) throw new Error('DEV_TOKEN_SECRET is required when AUTH_PROVIDER=dev');
  }
  if (e.MAIL_TRANSPORT === 'smtp' && !e.SMTP_URL) throw new Error('SMTP_URL is required when MAIL_TRANSPORT=smtp');
  const from = parseAddress(e.MAIL_FROM);
  if (e.MAIL_TRANSPORT === 'graph') {
    if (!e.GRAPH_TENANT_ID || !e.GRAPH_CLIENT_ID || !e.GRAPH_CLIENT_SECRET)
      throw new Error('GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are required when MAIL_TRANSPORT=graph');
    if (!from) throw new Error(`MAIL_FROM "${e.MAIL_FROM}" has no e-mail address`);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: e.APP_TIMEZONE });
  } catch {
    throw new Error(`APP_TIMEZONE "${e.APP_TIMEZONE}" is not a valid IANA time zone`);
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    db: { url: e.DATABASE_URL, poolMax: e.DB_POOL_MAX, migrateOnStart: e.DB_MIGRATE_ON_START },
    auth: {
      provider: e.AUTH_PROVIDER,
      devTokenSecret: e.DEV_TOKEN_SECRET ?? '',
      devLoginUser: e.DEV_LOGIN_USER,
      cacheTtlMs: e.AUTH_CACHE_TTL_SECONDS * 1000,
    },
    access: {
      permissionAdminGroups: e.PERMISSION_ADMIN_GROUPS,
    },
    timezone: e.APP_TIMEZONE,
    files: { uploadDir: e.UPLOAD_DIR, maxFileBytes: Math.round(e.MAX_FILE_MB * 1024 * 1024), maxFiles: e.MAX_FILES_PER_SUMMARY },
    excel: { exportMax: e.EXPORT_MAX, importMaxRows: e.IMPORT_MAX_ROWS },
    extensionDir: e.EXTENSION_DIR,
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    mail: {
      transport: e.MAIL_TRANSPORT,
      smtpUrl: e.SMTP_URL ?? '',
      from: e.MAIL_FROM,
      fromAddress: from?.address ?? '',
      fromName: from?.name ?? '',
      graph: { tenantId: e.GRAPH_TENANT_ID ?? '', clientId: e.GRAPH_CLIENT_ID ?? '', clientSecret: e.GRAPH_CLIENT_SECRET ?? '' },
      redirectTo: e.MAIL_REDIRECT_TO ?? '',
      previewDir: e.MAIL_PREVIEW_DIR,
      pollMs: e.MAIL_POLL_SECONDS * 1000,
      digestHour: e.DIGEST_HOUR,
    },
  };
}

/** `Name <a@b.c>` or a bare `a@b.c`. */
export function parseAddress(value: string): { name: string; address: string } | null {
  const m = /^\s*(?:"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))\s*$/.exec(value);
  if (!m) return null;
  return { name: (m[1] ?? '').trim(), address: m[2] ?? m[3] };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
