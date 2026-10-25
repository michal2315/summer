import { Controller, Get, Header, Inject, NotFoundException, Query } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DevIdentityProvider } from './dev-identity.provider';
import { IdentityProvider } from './identity-provider';
import { Public } from './auth.guard';

/**
 * DEV ONLY stand-in for the SAML popup. Point the client's `ssoUrl` at `/api/auth/dev-sso`: the page posts
 * `{ user: { token } }` to its opener (same origin through the dev proxy), exactly like the real SSO page.
 */
@Controller('auth')
export class DevSsoController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identity: IdentityProvider,
  ) {}

  @Public()
  @Get('dev-token')
  token(@Query('as') as?: string) {
    return { token: this.issue(as) };
  }

  @Public()
  @Get('dev-sso')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  page(@Query('as') as?: string): string {
    const token = JSON.stringify(this.issue(as));
    return `<!doctype html><meta charset="utf-8"><title>Summer dev SSO</title>
<p>Dev sign-in…</p>
<script>
  if (window.opener) { window.opener.postMessage({ user: { token: ${token} } }, location.origin); }
  else { document.body.textContent = 'Dev token: ' + ${token}; }
</script>`;
  }

  private issue(as?: string): string {
    if (!(this.identity instanceof DevIdentityProvider)) throw new NotFoundException();
    const token = this.identity.issue(as || this.config.auth.devLoginUser);
    if (!token) throw new NotFoundException('unknown dev user');
    return token;
  }
}
