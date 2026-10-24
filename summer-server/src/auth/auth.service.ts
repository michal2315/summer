import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { UsersRepository } from '../users/users.repository';
import { CurrentUser, IdentityProvider } from './identity-provider';

const MAX_CACHE = 2000;

/**
 * Bearer token → CurrentUser. The verified identity (and its groups) is cached for AUTH_CACHE_TTL_SECONDS,
 * which bounds how long a group revocation can take to apply. Permission-id mapping is re-read every request
 * (from a short-lived catalog cache), so admin changes to the permission catalog apply quickly.
 */
@Injectable()
export class AuthService {
  private readonly cache = new Map<string, { at: number; user: Omit<CurrentUser, 'permissionIds'>; isActive: boolean }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identity: IdentityProvider,
    private readonly users: UsersRepository,
    private readonly permissions: PermissionsRepository,
  ) {}

  async resolve(token: string): Promise<CurrentUser | null> {
    let entry = this.cache.get(token);
    if (!entry || Date.now() - entry.at > this.config.auth.cacheTtlMs) {
      this.cache.delete(token);
      const identity = await this.identity.verify(token);
      if (!identity) return null;
      const row = await this.users.upsertIdentity(identity);
      entry = {
        at: Date.now(),
        isActive: row.isActive,
        user: {
          id: row.id,
          username: row.username,
          fullName: row.fullName,
          department: row.department,
          isSystem: row.isSystem,
          groupKeys: identity.groupKeys,
        },
      };
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(token, entry);
    }
    if (!entry.isActive) throw new ForbiddenException('account is inactive');
    return { ...entry.user, permissionIds: await this.permissions.idsForGroupKeys(entry.user.groupKeys) };
  }

  /** Members of any listed external group. */
  inAnyGroup(user: CurrentUser, groups: string[]): boolean {
    return user.groupKeys.some((g) => groups.includes(g));
  }
}
