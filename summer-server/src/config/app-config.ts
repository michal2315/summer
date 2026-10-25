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
  DASHBOARD_GROUPS: csv,
  ACCESS_INHERIT_COLLECTION_PERMISSIONS: z.stringbool().default(false),

  APP_TIMEZONE: z.string().default('Asia/Jerusalem'),

  UPLOAD_DIR: z.string().default('.data/uploads'),
  MAX_FILE_MB: z.coerce.number().positive().default(50),
  MAX_FILES_PER_SUMMARY: z.coerce.number().int().positive().default(20),
  EXPORT_MAX: z.coerce.number().int().positive().default(5000),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(2000),
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
      dashboardGroups: e.DASHBOARD_GROUPS,
      inheritCollectionPermissions: e.ACCESS_INHERIT_COLLECTION_PERMISSIONS,
    },
    timezone: e.APP_TIMEZONE,
    files: { uploadDir: e.UPLOAD_DIR, maxFileBytes: Math.round(e.MAX_FILE_MB * 1024 * 1024), maxFiles: e.MAX_FILES_PER_SUMMARY },
    excel: { exportMax: e.EXPORT_MAX, importMaxRows: e.IMPORT_MAX_ROWS },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
