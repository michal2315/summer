import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEV_IDENTITIES, DEV_ISSUER, DevIdentity } from '../database/seed/identities';
import { IdentityProvider, VerifiedIdentity } from './identity-provider';

/**
 * DEV/TEST ONLY — refused at startup when NODE_ENV=production. Tokens are `dev.<username>.<hmac>` signed with
 * DEV_TOKEN_SECRET; identities and groups come from the fixture directory, not from the request.
 */
@Injectable()
export class DevIdentityProvider extends IdentityProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  issue(username: string): string | null {
    if (!this.find(username)) return null;
    const payload = Buffer.from(username, 'utf8').toString('base64url');
    return `dev.${payload}.${this.sign(payload)}`;
  }

  async verify(token: string): Promise<VerifiedIdentity | null> {
    const [prefix, payload, sig] = token.split('.');
    if (prefix !== 'dev' || !payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const identity = this.find(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!identity) return null;
    return {
      issuer: DEV_ISSUER,
      subject: identity.username,
      username: identity.username,
      fullName: identity.fullName,
      department: identity.department,
      email: identity.email,
      isSystem: identity.isSystem,
      groupKeys: identity.groups,
    };
  }

  private find(username: string): DevIdentity | undefined {
    return DEV_IDENTITIES.find((i) => i.username === username);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.auth.devTokenSecret).update(payload).digest('base64url');
  }
}

/** Placeholder for the real university SSO adapter: fails fast until its protocol and group API are specified. */
@Injectable()
export class SsoIdentityProvider extends IdentityProvider {
  constructor() {
    super();
    throw new Error('AUTH_PROVIDER=sso is not implemented yet: supply the SSO protocol, token validation and group API contract.');
  }

  async verify(): Promise<VerifiedIdentity | null> {
    return null;
  }
}
