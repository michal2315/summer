import { Injectable } from '@nestjs/common';
import { unique } from '../common/validation';
import { Capsule, CapsuleLookup, CapsuleProvider, NO_CAPSULES, capsuleLookup, normalizeCapsuleName } from './capsule';

const CACHE_TTL_MS = 60_000;

/** The external capsule service behind a short cache: one search touches the same capsules for its page and its counts. */
@Injectable()
export class CapsulesService {
  private readonly cache = new Map<string, { capsule: Capsule; at: number }>();

  constructor(private readonly provider: CapsuleProvider) {}

  async search(q: string, limit: number): Promise<Capsule[]> {
    const list = await this.provider.search(q, limit);
    this.remember(list);
    return list;
  }

  /** The capsules a request refers to, by id (advanced search, rules) and by name (`#name` in the search box). */
  async lookup(refs: { ids?: string[]; names?: string[] }): Promise<CapsuleLookup> {
    const ids = unique(refs.ids ?? []);
    const names = unique((refs.names ?? []).map(normalizeCapsuleName)).filter(Boolean);
    if (!ids.length && !names.length) return NO_CAPSULES;

    const found: Capsule[] = [];
    const missing = (key: string) => {
      const c = this.cached(key);
      if (c) found.push(c);
      return !c;
    };
    const missingIds = ids.filter((id) => missing(`id:${id}`));
    const missingNames = names.filter((n) => missing(`name:${n}`));
    const [byId, byName] = await Promise.all([
      missingIds.length ? this.provider.byIds(missingIds) : [],
      missingNames.length ? this.provider.byNames(missingNames) : [],
    ]);
    this.remember([...byId, ...byName]);
    return capsuleLookup([...found, ...byId, ...byName]);
  }

  private cached(key: string): Capsule | undefined {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.capsule;
    this.cache.delete(key);
    return undefined;
  }

  private remember(list: Capsule[]) {
    const at = Date.now();
    for (const capsule of list) {
      this.cache.set(`id:${capsule.id}`, { capsule, at });
      this.cache.set(`name:${normalizeCapsuleName(capsule.name)}`, { capsule, at });
    }
  }
}
