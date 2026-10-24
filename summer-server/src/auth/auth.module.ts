import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DevIdentityProvider, SsoIdentityProvider } from './dev-identity.provider';
import { DevSsoController } from './dev-sso.controller';
import { IdentityProvider } from './identity-provider';

@Global()
@Module({
  imports: [UsersModule, PermissionsModule],
  controllers: [DevSsoController],
  providers: [
    {
      provide: IdentityProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.auth.provider === 'dev' ? new DevIdentityProvider(config) : new SsoIdentityProvider()),
    },
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, IdentityProvider],
})
export class AuthModule {}
