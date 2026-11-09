import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DevIdentityProvider } from '../src/auth/dev-identity.provider';
import { IdentityProvider } from '../src/auth/identity-provider';
import { configureApp } from '../src/bootstrap';
import { createDb, runMigrations } from '../src/database/client';
import { seed } from '../src/database/seed/seed';

export interface Harness {
  app: INestApplication;
  /** Authenticated request helper for a dev user (see src/database/seed/identities.ts). */
  as(username: string): { get(p: string): request.Test; post(p: string): request.Test; put(p: string): request.Test; delete(p: string): request.Test };
  /** Raw SQL against the test database. */
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Re-run the deterministic seed (wipes all data). */
  reseed(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_TOKEN_SECRET: 'test-secret',
    AUTH_CACHE_TTL_SECONDS: '0',
    DB_MIGRATE_ON_START: 'false',
    PERMISSION_ADMIN_GROUPS: 'staff',
    DASHBOARD_GROUPS: 'staff',
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'summer-uploads-')),
    ...env,
  });

  const { db, pool } = createDb(process.env.DATABASE_URL!, 2);
  await runMigrations(db);
  await seed(db);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] }));
  await app.init();
  const identity = app.get(IdentityProvider) as DevIdentityProvider;
  const server = app.getHttpServer();

  const as = (username: string) => {
    const token = identity.issue(username);
    if (!token) throw new Error(`unknown dev user ${username}`);
    const auth = (t: request.Test) => t.set('authorization', `bearer ${token}`);
    return {
      get: (p: string) => auth(request(server).get(`/api${p}`)),
      post: (p: string) => auth(request(server).post(`/api${p}`)),
      put: (p: string) => auth(request(server).put(`/api${p}`)),
      delete: (p: string) => auth(request(server).delete(`/api${p}`)),
    };
  };

  return {
    app,
    as,
    sql: async (text, params) => (await pool.query(text, params)).rows,
    reseed: () => seed(db),
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
