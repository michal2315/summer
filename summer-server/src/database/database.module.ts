import { Global, Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RootDb, createDb, runMigrations } from './client';
import { DRIZZLE, DatabaseService, PG_POOL } from './database.service';

const connection = Symbol('DB_CONNECTION');

@Global()
@Module({
  providers: [
    { provide: connection, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createDb(config.db.url, config.db.poolMax) },
    { provide: PG_POOL, inject: [connection], useFactory: (c: ReturnType<typeof createDb>) => c.pool },
    { provide: DRIZZLE, inject: [connection], useFactory: (c: ReturnType<typeof createDb>) => c.db },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DRIZZLE) private readonly db: RootDb,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.db.migrateOnStart) return;
    await runMigrations(this.db);
    this.logger.log('migrations applied');
  }
}
