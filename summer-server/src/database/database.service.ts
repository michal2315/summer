import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from 'pg';
import { Db, RootDb } from './client';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE = Symbol('DRIZZLE');

interface TxContext {
  tx: Db;
  afterCommit: (() => unknown)[];
}

/**
 * Single entry point to PostgreSQL. Repositories read `db`, which is the active transaction when called
 * inside `transaction()` and the pool otherwise, so services compose repositories into one atomic unit
 * without passing a transaction handle around.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly als = new AsyncLocalStorage<TxContext>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE) private readonly root: RootDb,
  ) {}

  get db(): Db {
    return this.als.getStore()?.tx ?? this.root;
  }

  get inTransaction(): boolean {
    return !!this.als.getStore();
  }

  /** Run `fn` in a transaction. Nested calls join the outer transaction. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    const ctx: TxContext = { tx: this.root, afterCommit: [] };
    const result = await this.root.transaction((tx) => {
      ctx.tx = tx;
      return this.als.run(ctx, fn);
    });
    for (const hook of ctx.afterCommit) {
      try {
        await hook();
      } catch (e) {
        this.logger.error(`after-commit hook failed: ${(e as Error).message}`);
      }
    }
    return result;
  }

  /** Defer a side effect (e.g. deleting files) until the current transaction commits; runs now outside one. */
  async afterCommit(fn: () => unknown): Promise<void> {
    const ctx = this.als.getStore();
    if (ctx) ctx.afterCommit.push(fn);
    else await fn();
  }

  async ping(): Promise<boolean> {
    try {
      await this.root.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
