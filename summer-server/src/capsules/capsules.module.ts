import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CapsuleProvider } from './capsule';
import { CapsulesController } from './capsules.controller';
import { CapsulesService } from './capsules.service';
import { MockCapsuleProvider } from './mock-capsule.provider';

/** Capsules come from an external service; until it is wired in, the mock serves demo data (instant under test). */
@Global()
@Module({
  controllers: [CapsulesController],
  providers: [
    { provide: CapsuleProvider, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new MockCapsuleProvider(config.env === 'test' ? 0 : 120) },
    CapsulesService,
  ],
  exports: [CapsulesService],
})
export class CapsulesModule {}
